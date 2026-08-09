import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 1. Fetch active users along with their selected currency
    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, email, selected_currency')
      .eq('is_hold', false);

    if (userError) throw userError;

    // 2. Calculate today's date bounds based strictly on UAE Time (GST / UTC+4)
    const uaeDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }); // YYYY-MM-DD
    
    // Currency symbols mapping
    const currencySymbols = { "AED": "AED ", "USD": "$", "INR": "₹", "EUR": "€" };

    for (const user of users) {
      if (!user.email) continue;

      // Extract user currency with safety fallback
      const userCurrency = user.selected_currency || 'AED';
      const userSymbol = currencySymbols[userCurrency] || 'AED ';

      // 3. Check if user logged any debit transactions today in UAE time window
      const { data: dailyTxns, error: txError } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${uaeDateStr}T00:00:00+04:00`)
        .lte('created_at', `${uaeDateStr}T23:59:59+04:00`);

      if (txError) throw txError;

      // 4. Skip users who already logged transactions today
      if (dailyTxns && dailyTxns.length > 0) {
        continue;
      }

      // 5. Generate reminder email content with custom currency notation
      const emailHtmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 30px 10px; background: #070913; color: #ffffff; font-family: -apple-system, sans-serif;">
          <div style="max-width: 460px; margin: 0 auto; background: #0d1127; border: 1px solid #242b54; border-top: 4px solid #6366f1; border-radius: 16px; padding: 28px;">
            
            <div style="margin-bottom: 20px;">
              <span style="color: #818cf8; font-weight: 800; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; display: block; margin-bottom: 4px;">⚡ VAULT TERMINAL</span>
              <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700;">Expense Reminder</h2>
            </div>

            <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
              Hey <strong>${user.name}</strong>, you haven't logged any expenses for today (<strong>${uaeDateStr}</strong>) yet.
            </p>

            <div style="background: #161b33; border: 1px dashed #4f46e5; padding: 18px; border-radius: 12px; text-align: center; margin-bottom: 24px;">
              <p style="color: #9ca3af; font-size: 13px; margin: 0 0 14px 0;">
                Log your daily transactions to keep your monthly <strong>${userSymbol}</strong> spending metrics up to date!
              </p>
              <a href="https://your-app-domain.com" style="background: #6366f1; color: #ffffff; text-decoration: none; padding: 10px 20px; font-size: 13px; font-weight: 700; border-radius: 8px; display: inline-block;">
                + Add Today's Expense (${userCurrency})
              </a>
            </div>

            <div style="text-align: center; border-top: 1px solid #242b54; padding-top: 16px;">
              <p style="color: #8696ad; font-size: 11px; margin: 0;">Auto-generated reminder by Vault Terminal • UAE Timezone</p>
            </div>

          </div>
        </body>
        </html>
      `;

      // 6. Send reminder email
      await resend.emails.send({
        from: 'Vault Terminal <alerts@drivehouse.ae>',
        to: user.email,
        subject: `📌 Friendly Reminder: Add your expenses for today`,
        html: emailHtmlContent,
      });

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return new Response(JSON.stringify({ success: true, message: 'UAE reminders processed successfully.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("REMINDER CRON ERROR:", err.message || err);
    return new Response(JSON.stringify({ error: err.message || err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
