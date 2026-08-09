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

    // Calculate UAE "Yesterday" since script runs at 3:30 AM UAE time
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const uaeYesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

    const firstDayOfMonth = new Date(yesterday.getFullYear(), yesterday.getMonth(), 1);
    const startOfMonthStr = firstDayOfMonth.toISOString().split('T')[0];

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonthLabel = monthNames[yesterday.getMonth()];

    const currencySymbols = { "AED": "AED ", "USD": "$", "INR": "₹", "EUR": "€" };
    const liveRates = { "USD": 0.2722, "INR": 22.65, "EUR": 0.25, "AED": 1.0 };

    for (const user of users) {
      if (!user.email) continue;

      const userCurrency = user.selected_currency || 'AED';
      const userSymbol = currencySymbols[userCurrency] || 'AED ';
      const toBaseFactor = liveRates[userCurrency] / liveRates['AED'];

      // Query yesterday's debit transactions
      const { data: dailyTxns, error: txError } = await supabase
        .from('transactions')
        .select('description, amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${uaeYesterdayStr}T00:00:00+04:00`)
        .lte('created_at', `${uaeYesterdayStr}T23:59:59+04:00`);

      if (txError) throw txError;

      // Skip users with zero expenses yesterday
      if (!dailyTxns || dailyTxns.length === 0) continue;

      const { data: monthlyTxns, error: mTxError } = await supabase
        .from('transactions')
        .select('amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${startOfMonthStr}T00:00:00+04:00`)
        .lte('created_at', `${uaeYesterdayStr}T23:59:59+04:00`);

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
          <div style="background-color: #0d1322; border: 1px solid #1e293b; padding: 12px 16px; margin-bottom: 8px; border-radius: 12px;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="left" valign="middle">
                  <div style="color: #ffffff !important; font-size: 13px; font-weight: 600; font-family: -apple-system, sans-serif;">${t.description}</div>
                  <div style="margin-top: 4px;">
                    <span style="background-color: #1e1b4b; color: #a5b4fc !important; font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
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
              <div style="width: 100%; background-color: #1e293b; height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="width: ${percentage}%; background-color: #6366f1; height: 100%; border-radius: 3px;"></div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        metricsHtml = `<div style="color: #64748b !important; font-size: 12px; text-align: center; padding: 8px;">No monthly trends recorded.</div>`;
      }

      const emailHtmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Daily Statement</title>
        </head>
        <body style="margin: 0; padding: 0; width: 100% !important; background-color: #030712; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="background-color: #030712; padding: 24px 10px; width: 100%;">
            <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="max-width: 480px; margin: 0 auto; background-color: #080c14; border: 1px solid #1e293b; border-top: 3px solid #6366f1; border-radius: 16px; overflow: hidden;">
              
              <!-- Header -->
              <tr>
                <td style="padding: 24px 20px; border-bottom: 1px solid #1e293b;">
                  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td align="left" valign="middle" width="50" style="width: 50px;">
                        <img src="https://kfbtsoszcfnoovjvomir.supabase.co/storage/v1/object/public/public-assets/Gemini_Generated_Image_bn2wfabn2wfabn2w.png" width="42" height="42" style="width: 42px; height: 42px; border-radius: 10px; display: block; border: 1px solid #1e293b;" alt="Vault Logo" />
                      </td>
                      <td align="left" valign="middle" style="padding-left: 10px;">
                        <span style="color: #818cf8 !important; font-weight: 800; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; display: block; margin-bottom: 2px;">⚡ VAULT TERMINAL</span>
                        <h2 style="color: #ffffff !important; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.4px;">Daily Statement</h2>
                      </td>
                      <td align="right" valign="middle" style="color: #64748b !important; font-size: 11px; font-family: 'Courier New', Courier, monospace; font-weight: 700;">
                        ${uaeYesterdayStr}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Greeting -->
              <tr>
                <td style="padding: 20px; color: #cbd5e1 !important; font-size: 14px; line-height: 1.6;">
                  Yo <strong style="color: #ffffff !important; border-bottom: 1px dashed #6366f1; padding-bottom: 1px;">${user.name}</strong>, here is your expense breakdown for yesterday:
                </td>
              </tr>

              <!-- Yesterday Activity -->
              <tr>
                <td style="padding: 0 20px 20px 20px;">
                  <h3 style="color: #64748b !important; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 10px 0;">📅 Yesterday's Activity</h3>
                  ${breakdownHtml}
                </td>
              </tr>

              <!-- Monthly Spending -->
              <tr>
                <td style="padding: 0 20px 20px 20px;">
                  <div style="background-color: #0d1322; border: 1px solid #1e293b; padding: 16px; border-radius: 12px;">
                    <h3 style="color: #818cf8 !important; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 14px 0;">📊 Top ${currentMonthLabel} Spending</h3>
                    ${metricsHtml}
                  </div>
                </td>
              </tr>

              <!-- Total Metric Cards -->
              <tr>
                <td style="padding: 0 20px 20px 20px;">
                  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td width="48%" valign="middle" style="background-color: #0d1322; border: 1px solid #1e293b; padding: 14px 10px; border-radius: 12px; text-align: center;">
                        <span style="color: #64748b !important; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; font-weight: 700; font-family: -apple-system, sans-serif;">Daily Total</span>
                        <span style="color: #ffffff !important; font-size: 15px; font-weight: 700; font-family: 'Courier New', Courier, monospace; display: block;">${userSymbol}${totalDailySpend.toFixed(2)}</span>
                      </td>
                      <td width="4%">&nbsp;</td>
                      <td width="48%" valign="middle" style="background-color: #1e1b4b; border: 1px solid #4f46e5; padding: 14px 10px; border-radius: 12px; text-align: center;">
                        <span style="color: #a5b4fc !important; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; font-weight: 700; font-family: -apple-system, sans-serif;">MTD Total</span>
                        <span style="color: #34d399 !important; font-size: 15px; font-weight: 700; font-family: 'Courier New', Courier, monospace; display: block;">${userSymbol}${totalMonthlySpend.toFixed(2)}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding: 16px 20px 20px 20px; border-top: 1px solid #1e293b; text-align: center;">
                  <p style="color: #64748b !important; font-size: 11px; margin: 0; font-weight: 500;">
                    This statement is auto-generated by finance tracker.
                  </p>
                  <p style="color: #818cf8 !important; font-size: 10px; margin: 6px 0 0 0; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 800;">
                    DESIGNED BY RAHUL
                  </p>
                </td>
              </tr>

            </table>
          </div>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: 'Vault Terminal <alerts@drivehouse.ae>',
        to: user.email,
        subject: `Daily Expense Statement - ${uaeYesterdayStr}`,
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
