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
          <html lang="en" style="color-scheme: dark; supported-color-schemes: dark;">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta name="color-scheme" content="dark">
            <meta name="supported-color-schemes" content="dark">
            <title>Expense Reminder</title>
            <style>
              :root { color-scheme: dark; supported-color-schemes: dark; }
              body, html { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #030712 !important; color: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
              * { box-sizing: border-box; }
              @media screen and (max-width: 520px) {
                .container { width: 100% !important; padding: 16px 12px !important; }
                .content-card { padding: 20px 16px !important; }
                .cta-button { display: block !important; width: 100% !important; padding: 14px 16px !important; }
              }
            </style>
          </head>
          <body style="margin: 0; padding: 24px 8px; background-color: #030712; color: #ffffff;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #030712; table-layout: fixed;">
              <tr>
                <td align="center" valign="top">
                  <div class="container" style="max-width: 480px; width: 100%; margin: 0 auto;">
                    <div class="content-card" style="background: #090d16; border: 1px solid #1e293b; border-top: 3px solid #6366f1; border-radius: 20px; padding: 28px 24px; box-shadow: 0 20px 40px -15px rgba(0,0,0,0.8);">
                      
                      <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom: 1px solid #1e293b; padding-bottom: 18px; margin-bottom: 22px;">
                        <tr>
                          <td align="left" valign="middle" width="52" style="width: 52px; padding-right: 12px;">
                            <img src="https://kfbtsoszcfnoovjvomir.supabase.co/storage/v1/object/public/public-assets/Gemini_Generated_Image_bn2wfabn2wfabn2w.png" width="46" height="46" style="width: 46px; height: 46px; border-radius: 12px; display: block; border: 1px solid #1e293b;" alt="Vault Logo" />
                          </td>
                          <td align="left" valign="middle">
                            <span style="color: #818cf8 !important; font-weight: 800; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; display: block; margin-bottom: 2px;">⚡ VAULT TERMINAL</span>
                            <h2 style="color: #ffffff !important; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.4px;">Expense Reminder</h2>
                          </td>
                          <td align="right" valign="middle" style="color: #64748b !important; font-size: 12px; font-family: 'Courier New', Courier, monospace; font-weight: 700;">
                            ${uaeDateStr}
                          </td>
                        </tr>
                      </table>

                      <p style="color: #cbd5e1 !important; font-size: 14px; line-height: 1.6; margin: 0 0 22px 0; text-align: left;">
                        Yo <strong style="color: #ffffff !important; border-bottom: 1px dashed #6366f1; padding-bottom: 1px;">${user.name}</strong>, you haven't logged any expenses for today yet.
                      </p>

                      <div style="background: #0d1322; border: 1px dashed #312e81; padding: 20px 16px; border-radius: 14px; text-align: center; margin-bottom: 24px;">
                        <p style="color: #94a3b8 !important; font-size: 13px; margin: 0 0 16px 0; line-height: 1.5;">
                          Log your daily activity to maintain your spending metrics in <strong>${userSymbol}</strong> (${userCurrency}).
                        </p>
                        <a href="https://finance-monitor-sigma.vercel.app" class="cta-button" style="background: #6366f1; color: #ffffff !important; text-decoration: none; padding: 12px 24px; font-size: 13px; font-weight: 700; border-radius: 10px; display: inline-block; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35); text-align: center;">
                          + Log Today's Expense
                        </a>
                      </div>

                      <div style="border-top: 1px solid #1e293b; padding-top: 18px; text-align: center;">
                        <p style="color: #64748b !important; font-size: 11px; margin: 0; font-weight: 500;">
                          This reminder is auto-generated by finance tracker.
                        </p>
                        <p style="color: #818cf8 !important; font-size: 10px; margin: 6px 0 0 0; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 800;">
                          DESIGNED BY RAHUL
                        </p>
                      </div>

                    </div>
                  </div>
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
