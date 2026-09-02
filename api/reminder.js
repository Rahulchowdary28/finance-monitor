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

  const { searchParams } = new URL(request.url);
  const isDryRun = searchParams.get('dryRun') === 'true' || searchParams.get('test') === 'true';

  try {
    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, email, selected_currency')
      .eq('is_hold', false);

    if (userError) throw userError;

    const uaeDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const currencySymbols = { "AED": "AED ", "USD": "$", "INR": "₹", "EUR": "€" };
    const emailLog = [];

    for (const user of users) {
      if (!user.email) continue;

      const userCurrency = user.selected_currency || 'AED';
      const userSymbol = currencySymbols[userCurrency] || 'AED ';

      const { data: dailyTxns, error: txError } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${uaeDateStr}T00:00:00+04:00`)
        .lte('created_at', `${uaeDateStr}T23:59:59+04:00`);

      if (txError) throw txError;

      // Skip users who already logged expenses today
      if (dailyTxns && dailyTxns.length > 0) continue;

      emailLog.push({ name: user.name, email: user.email, currency: userCurrency });

      if (!isDryRun) {
        const emailHtmlContent = `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta name="color-scheme" content="dark">
            <meta name="supported-color-schemes" content="dark">
            <title>Expense Reminder</title>
            <style>
              :root { color-scheme: dark; supported-color-schemes: dark; }
              [data-ogsc] .bg-body { background-color: #030712 !important; background-image: linear-gradient(#030712, #030712) !important; }
              [data-ogsc] .bg-card { background-color: #090d16 !important; background-image: linear-gradient(#090d16, #090d16) !important; }
              [data-ogsc] .bg-subcard { background-color: #0d1322 !important; background-image: linear-gradient(#0d1322, #0d1322) !important; }
              [data-ogsc] .text-white { color: #ffffff !important; }

              [data-ogsb] .bg-body { background-color: #030712 !important; background-image: linear-gradient(#030712, #030712) !important; }
              [data-ogsb] .bg-card { background-color: #090d16 !important; background-image: linear-gradient(#090d16, #090d16) !important; }
              [data-ogsb] .bg-subcard { background-color: #0d1322 !important; background-image: linear-gradient(#0d1322, #0d1322) !important; }
              [data-ogsb] .text-white { color: #ffffff !important; }
            </style>
          </head>
          <body class="bg-body" style="margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #030712; background-image: linear-gradient(#030712, #030712); color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" class="bg-body" style="background-color: #030712; background-image: linear-gradient(#030712, #030712); table-layout: fixed; width: 100%;">
              <tr>
                <td align="center" valign="top" style="padding: 16px 8px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" class="bg-card" style="max-width: 460px; margin: 0 auto; background-color: #090d16; background-image: linear-gradient(#090d16, #090d16); border: 1px solid #1e293b; border-top: 3px solid #6366f1; border-radius: 16px; overflow: hidden;">
                    
                    <!-- Header -->
                    <tr>
                      <td style="padding: 20px; border-bottom: 1px solid #1e293b;">
                        <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                          <tr>
                            <td align="left" valign="middle" width="46" style="width: 46px;">
                              <img src="https://kfbtsoszcfnoovjvomir.supabase.co/storage/v1/object/public/public-assets/Gemini_Generated_Image_bn2wfabn2wfabn2w.png" width="40" height="40" style="width: 40px; height: 40px; border-radius: 10px; display: block; border: 1px solid #1e293b;" alt="Vault Logo" />
                            </td>
                            <td align="left" valign="middle" style="padding-left: 10px;">
                              <span style="color: #818cf8 !important; font-weight: 800; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; display: block; margin-bottom: 2px;">⚡ VAULT TERMINAL</span>
                              <h2 class="text-white" style="color: #ffffff !important; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.4px;">Expense Reminder</h2>
                            </td>
                            <td align="right" valign="middle" style="color: #64748b !important; font-size: 11px; font-family: 'Courier New', Courier, monospace; font-weight: 700;">
                              ${uaeDateStr}
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <!-- Message -->
                    <tr>
                      <td style="padding: 20px 20px 16px 20px; color: #cbd5e1 !important; font-size: 14px; line-height: 1.6;">
                        Yo <strong class="text-white" style="color: #ffffff !important; border-bottom: 1px dashed #6366f1; padding-bottom: 1px;">${user.name}</strong>, you haven't logged any expenses for today yet.
                      </td>
                    </tr>

                    <!-- CTA Card -->
                    <tr>
                      <td style="padding: 0 20px 20px 20px;">
                        <div class="bg-subcard" style="background-color: #0d1322; background-image: linear-gradient(#0d1322, #0d1322); border: 1px dashed #312e81; padding: 20px 16px; border-radius: 12px; text-align: center;">
                          <p style="color: #94a3b8 !important; font-size: 13px; margin: 0 0 16px 0; line-height: 1.5;">
                            Log your daily activity to maintain your spending metrics in <strong>${userSymbol}</strong> (${userCurrency}).
                          </p>
                          <a href="https://finance-monitor-sigma.vercel.app" style="background-color: #6366f1; background-image: linear-gradient(#6366f1, #6366f1); color: #ffffff !important; text-decoration: none; padding: 12px 24px; font-size: 13px; font-weight: 700; border-radius: 10px; display: inline-block; text-align: center;">
                            + Log Today's Expense
                          </a>
                        </div>
                      </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                      <td style="padding: 16px 20px; border-top: 1px solid #1e293b; text-align: center;">
                        <p style="color: #64748b !important; font-size: 11px; margin: 0; font-weight: 500;">
                          This reminder is auto-generated by finance tracker.
                        </p>
                        <p style="color: #818cf8 !important; font-size: 10px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 800;">
                          DESIGNED BY RAHUL
                        </p>
                      </td>
                    </tr>

                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `;

        await resend.emails.send({
          from: 'Vault Terminal <alerts@drivehouse.ae>',
          to: user.email,
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
        recipientsCount: emailLog.length,
        pendingRecipients: emailLog,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error("REMINDER ERROR:", err.message || err);
    return new Response(JSON.stringify({ error: err.message || err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
