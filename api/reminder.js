import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized security perimeter breach.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Safe testing toggle: append ?dryRun=true to test without sending real emails
  const { searchParams } = new URL(request.url);
  const isDryRun = searchParams.get('dryRun') === 'true' || searchParams.get('test') === 'true';

  try {
    // 1. Fetch active users with currency settings
    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, email, selected_currency')
      .eq('is_hold', false);

    if (userError) throw userError;

    // 2. Strict UAE Date calculation (GST / UTC+4)
    const uaeDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const currencySymbols = { "AED": "AED ", "USD": "$", "INR": "₹", "EUR": "€" };

    const emailLog = [];

    for (const user of users) {
      if (!user.email) continue;

      const userCurrency = user.selected_currency || 'AED';
      const userSymbol = currencySymbols[userCurrency] || 'AED ';

      // 3. Query transactions made during UAE calendar day
      const { data: dailyTxns, error: txError } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${uaeDateStr}T00:00:00+04:00`)
        .lte('created_at', `${uaeDateStr}T23:59:59+04:00`);

      if (txError) throw txError;

      // 4. Skip users who already logged expenses today
      if (dailyTxns && dailyTxns.length > 0) {
        continue;
      }

      emailLog.push({ name: user.name, email: user.email, currency: userCurrency });

      // 5. Generate matching email design & send (skipped if dryRun is true)
      if (!isDryRun) {
        const emailHtmlContent = `
          <!DOCTYPE html>
          <html lang="en" style="color-scheme: dark; supported-color-schemes: dark;">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta name="color-scheme" content="dark">
            <meta name="supported-color-schemes" content="dark">
            <style>
              body, .bg-wrapper { background: linear-gradient(#070913, #070913) !important; color: #ffffff !important; }
              div, p, td, h2, h3, span { font-smoothing: antialiased; -webkit-font-smoothing: antialiased; }
            </style>
          </head>
          <body style="margin: 0; padding: 30px 10px; background: linear-gradient(#070913, #070913); color: #ffffff;">
            <div class="bg-wrapper" style="max-width: 460px; margin: 0 auto; background: linear-gradient(#070913, #070913); border: 1px solid #242b54; border-top: 4px solid #6366f1; border-radius: 16px; padding: 28px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.75);">
              
              <!-- Header Table with Vault Logo -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #242b54; padding-bottom: 16px; margin-bottom: 24px; table-layout: fixed;">
                <tr>
                  <td align="left" valign="middle" width="65" style="width: 65px; padding-right: 12px;">
                    <img src="https://kfbtsoszcfnoovjvomir.supabase.co/storage/v1/object/public/public-assets/Gemini_Generated_Image_bn2wfabn2wfabn2w.png" width="55" height="55" style="width: 55px; height: 55px; border-radius: 28px; display: block; border: 1px solid #242b54;" alt="Vault Logo" />
                  </td>
                  <td align="left" valign="middle">
                    <span style="color: #818cf8 !important; font-weight: 800; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; font-family: -apple-system, sans-serif; display: block; margin-bottom: 4px;">⚡ VAULT TERMINAL</span>
                    <h2 style="color: #ffffff !important; margin: 0; font-size: 20px; font-weight: 700; font-family: -apple-system, sans-serif; letter-spacing: -0.5px;">Expense Reminder</h2>
                  </td>
                  <td align="right" valign="middle" width="95" style="width: 95px; min-width: 95px; text-align: right; white-space: nowrap !important; color: #8696ad !important; font-size: 13px; font-family: 'Courier New', Courier, monospace; font-weight: 700;">
                    ${uaeDateStr}
                  </td>
                </tr>
              </table>

              <!-- Body Message -->
              <p style="color: #cbd5e1 !important; font-size: 14px; line-height: 1.6; font-family: -apple-system, sans-serif; margin-bottom: 24px; text-align: left;">
                Yo! <strong style="color: #ffffff !important; border-bottom: 1px dashed #6366f1; padding-bottom: 2px;">${user.name}</strong>, you haven't logged any expenses for today yet.
              </p>

              <!-- Call-To-Action Box -->
              <div style="background: linear-gradient(#0d1127, #0d1127); border: 1px dashed #4f46e5; padding: 22px; border-radius: 14px; text-align: center; margin-bottom: 28px;">
                <p style="color: #9ca3af !important; font-size: 13px; margin: 0 0 16px 0; font-family: -apple-system, sans-serif; line-height: 1.5;">
                  Log your daily activity to maintain your spending metrics in <strong>${userSymbol}</strong> (${userCurrency}).
                </p>
                <a href="https://finance-monitor-sigma.vercel.app" style="background: #6366f1; color: #ffffff !important; text-decoration: none; padding: 11px 22px; font-size: 13px; font-weight: 700; border-radius: 8px; display: inline-block; font-family: -apple-system, sans-serif; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                  + Log Today's Expense
                </a>
              </div>

              <!-- Footer -->
              <div style="margin-top: 36px; text-align: center; border-top: 1px solid #242b54; padding-top: 16px;">
                <p style="color: #8696ad !important; font-size: 11px; margin: 0; font-family: -apple-system, sans-serif; line-height: 1.5; font-weight: 500;">
                  This reminder is auto-generated by finance tracker.
                </p>
                <p style="color: #6366f1 !important; font-size: 10px; margin: 6px 0 0 0; font-family: -apple-system, sans-serif; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">
                  Designed by Rahul
                </p>
              </div>

            </div>
          </body>
          </html>
        `;

        await resend.emails.send({
          from: 'Vault Terminal <alerts@drivehouse.ae>',
          to: rahulchowdary8@outlook.com,
          subject: `📌 Reminder: Add your expenses for ${uaeDateStr}`,
          html: emailHtmlContent,
        });

        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun: isDryRun,
        message: isDryRun 
          ? `[TEST MODE] Dry run completed. No emails were sent.`
          : `Reminder telemetry delivered successfully.`,
        recipientsCount: emailLog.length,
        pendingRecipients: emailLog,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (err) {
    console.error("REMINDER CRASH ERROR:", err.message || err);
    return new Response(JSON.stringify({ error: err.message || err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
