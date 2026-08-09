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

  try {
    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, email, selected_currency')
      .eq('is_hold', false);

    if (userError) throw userError;

    const uaeDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfMonthStr = firstDayOfMonth.toISOString().split('T')[0];

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonthLabel = monthNames[today.getMonth()];

    const currencySymbols = { "AED": "AED ", "USD": "$", "INR": "₹", "EUR": "€" };
    const liveRates = { "USD": 0.2722, "INR": 22.65, "EUR": 0.25, "AED": 1.0 };

    for (const user of users) {
      if (!user.email) continue;

      const userCurrency = user.selected_currency || 'AED';
      const userSymbol = currencySymbols[userCurrency] || 'AED ';
      const toBaseFactor = liveRates[userCurrency] / liveRates['AED'];

      const { data: dailyTxns, error: txError } = await supabase
        .from('transactions')
        .select('description, amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${uaeDateStr}T00:00:00+04:00`)
        .lte('created_at', `${uaeDateStr}T23:59:59+04:00`);

      if (txError) throw txError;

      // Skip users with zero daily expenses
      if (!dailyTxns || dailyTxns.length === 0) continue;

      const { data: monthlyTxns, error: mTxError } = await supabase
        .from('transactions')
        .select('amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${startOfMonthStr}T00:00:00+04:00`)
        .lte('created_at', `${uaeDateStr}T23:59:59+04:00`);

      if (mTxError) throw mTxError;

      const totalDailySpend = dailyTxns.reduce((sum, t) => sum + (parseFloat(t.amount) * toBaseFactor), 0);
      const totalMonthlySpend = monthlyTxns ? monthlyTxns.reduce((sum, t) => sum + (parseFloat(t.amount) * toBaseFactor), 0) : 0;

      const categoriesMap = {};
      if (monthlyTxns) {
        monthlyTxns.forEach(t => {
          const amt = parseFloat(t.amount) * toBaseFactor;
          categoriesMap[t.category] = (categoriesMap[t.category] || 0) + amt;
        });
      }

      const sortedCategories = Object.entries(categoriesMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      const breakdownHtml = dailyTxns.map(t => {
        const itemConvertedAmount = parseFloat(t.amount) * toBaseFactor;
        return `
          <div style="background: #0d1322; border: 1px solid #1e293b; padding: 12px 16px; margin-bottom: 8px; border-radius: 12px;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="left" valign="middle">
                  <div style="color: #ffffff !important; font-size: 13px; font-weight: 600; font-family: -apple-system, sans-serif;">${t.description}</div>
                  <div style="margin-top: 4px;">
                    <span style="background: #1e1b4b; color: #a5b4fc !important; font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                      📂 ${t.category}
                    </span>
                  </div>
                </td>
                <td align="right" valign="middle" style="color: #f87171 !important; font-size: 15px; font-weight: 700; font-family: 'Courier New', Courier, monospace;">
                  -${userSymbol}${itemConvertedAmount.toFixed(2)}
                </td>
              </tr>
            </table>
          </div>
        `;
      }).join('');

      let metricsHtml = "";
      if (totalMonthlySpend > 0 && sortedCategories.length > 0) {
        metricsHtml = sortedCategories.map(([cat, amt]) => {
          const percentage = ((amt / totalMonthlySpend) * 100).toFixed(0);
          return `
            <div style="margin-bottom: 12px; font-family: -apple-system, sans-serif;">
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="font-size: 11px; margin-bottom: 4px;">
                <tr>
                  <td align="left" style="color: #94a3b8 !important; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${cat}</td>
                  <td align="right" style="color: #ffffff !important; font-weight: 700; font-family: 'Courier New', Courier, monospace;">
                    ${userSymbol}${amt.toFixed(2)} <span style="color: #818cf8 !important; font-weight: 500;">(${percentage}%)</span>
                  </td>
                </tr>
              </table>
              <div style="width: 100%; background: #1e293b; height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="width: ${percentage}%; background: #6366f1; height: 100%; border-radius: 3px;"></div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        metricsHtml = `<div style="color: #64748b !important; font-size: 12px; text-align: center; padding: 8px;">No monthly trends recorded.</div>`;
      }

      const emailHtmlContent = `
        <!DOCTYPE html>
        <html lang="en" style="color-scheme: dark; supported-color-schemes: dark;">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="color-scheme" content="dark">
          <meta name="supported-color-schemes" content="dark">
          <title>Daily Statement</title>
          <style>
            :root { color-scheme: dark; supported-color-schemes: dark; }
            body, html { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #030712 !important; color: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
            * { box-sizing: border-box; }
            @media screen and (max-width: 520px) {
              .container { width: 100% !important; padding: 16px 12px !important; }
              .content-card { padding: 20px 16px !important; }
              .metric-box { display: block !important; width: 100% !important; margin-bottom: 8px !important; }
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
                          <h2 style="color: #ffffff !important; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.4px;">Daily Statement</h2>
                        </td>
                        <td align="right" valign="middle" style="color: #64748b !important; font-size: 12px; font-family: 'Courier New', Courier, monospace; font-weight: 700;">
                          ${uaeDateStr}
                        </td>
                      </tr>
                    </table>

                    <p style="color: #cbd5e1 !important; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
                      Yo <strong style="color: #ffffff !important; border-bottom: 1px dashed #6366f1; padding-bottom: 1px;">${user.name}</strong>, here is your expense breakdown for today:
                    </p>

                    <div style="margin-bottom: 24px;">
                      <h3 style="color: #64748b !important; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px;">📅 Today's Activity</h3>
                      ${breakdownHtml}
                    </div>

                    <div style="background: #0d1322; border: 1px solid #1e293b; padding: 16px; border-radius: 14px; margin-bottom: 24px;">
                      <h3 style="color: #818cf8 !important; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 0; margin-bottom: 14px;">📊 Top ${currentMonthLabel} Spending</h3>
                      ${metricsHtml}
                    </div>

                    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom: 20px;">
                      <tr>
                        <td width="48%" class="metric-box" valign="middle" style="background: #0d1322; border: 1px solid #1e293b; padding: 16px 12px; border-radius: 12px; text-align: center;">
                          <span style="color: #64748b !important; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px; font-weight: 700; font-family: -apple-system, sans-serif;">Daily Total</span>
                          <span style="color: #ffffff !important; font-size: 15px; font-weight: 700; font-family: 'Courier New', Courier, monospace; display: block;">${userSymbol}${totalDailySpend.toFixed(2)}</span>
                        </td>
                        <td width="4%">&nbsp;</td>
                        <td width="48%" class="metric-box" valign="middle" style="background: #1e1b4b; border: 1px solid #4f46e5; padding: 16px 12px; border-radius: 12px; text-align: center; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);">
                          <span style="color: #a5b4fc !important; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px; font-weight: 700; font-family: -apple-system, sans-serif;">MTD Total</span>
                          <span style="color: #34d399 !important; font-size: 15px; font-weight: 700; font-family: 'Courier New', Courier, monospace; display: block;">${userSymbol}${totalMonthlySpend.toFixed(2)}</span>
                        </td>
                      </tr>
                    </table>

                    <div style="border-top: 1px solid #1e293b; padding-top: 18px; text-align: center;">
                      <p style="color: #64748b !important; font-size: 11px; margin: 0; font-weight: 500;">
                        This statement is auto-generated by finance tracker.
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
        subject: `Daily Expense Statement - ${uaeDateStr}`,
        html: emailHtmlContent,
      });

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return new Response(JSON.stringify({ success: true, message: 'Daily statements delivered successfully.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("STATEMENT ERROR:", err.message || err);
    return new Response(JSON.stringify({ error: err.message || err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
