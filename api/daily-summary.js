import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://kfbtsoszcfnoovjvomir.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_md-VYPsxNFbHtkUalYbnLw_9tidXE03'
);
const resendApiKey = process.env.RESEND_API_KEY || 're_12345';
const resend = new Resend(resendApiKey);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const isVercelCron = req.headers['x-vercel-cron'] === '1';

  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron) {
    return res.status(401).json({ error: 'Unauthorized security perimeter breach.' });
  }

  try {
    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, email, selected_currency')
      .eq('is_hold', false);

    if (userError) throw userError;

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const uaeYesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const firstDayOfMonth = new Date(yesterday.getFullYear(), yesterday.getMonth(), 1);
    const startOfMonthStr = firstDayOfMonth.toISOString().split('T')[0];

    const monthNames = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    const currentMonthLabel = monthNames[yesterday.getMonth()];

    const currencySymbols = { "AED": "AED ", "USD": "$", "INR": "₹", "EUR": "€" };
    const liveRates = { "USD": 0.2722, "INR": 22.65, "EUR": 0.25, "AED": 1.0 };

    let sentCount = 0;

    for (const user of users) {
      if (!user.email) continue;

      const userCurrency = user.selected_currency || 'AED';
      const userSymbol = currencySymbols[userCurrency] || 'AED ';
      const toBaseFactor = liveRates[userCurrency] / liveRates['AED'];

      const { data: dailyTxns, error: txError } = await supabase
        .from('transactions')
        .select('description, amount, category')
        .ilike('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${uaeYesterdayStr}T00:00:00+04:00`)
        .lte('created_at', `${uaeYesterdayStr}T23:59:59+04:00`);

      if (txError) throw txError;
      if (!dailyTxns || dailyTxns.length === 0) continue;

      const { data: monthlyTxns, error: mTxError } = await supabase
        .from('transactions')
        .select('amount, category')
        .ilike('user_name', user.name)
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
          <div style="background-color: #12141d; background-image: linear-gradient(#12141d, #12141d); border: 1px solid #1e2235; padding: 14px 16px; margin-bottom: 10px; border-radius: 12px;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="left" valign="middle">
                  <div style="color: #ffffff !important; font-size: 14px; font-weight: 700; font-family: -apple-system, sans-serif;">${t.description}</div>
                  <div style="margin-top: 6px;">
                    <span style="background-color: #1e1b4b; background-image: linear-gradient(#1e1b4b, #1e1b4b); color: #a5b4fc !important; font-size: 9px; padding: 3px 8px; border-radius: 4px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; display: inline-block;">
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
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="font-size: 11px;">
                <tr>
                  <td align="left" style="color: #8b95a5 !important; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;">${cat}</td>
                  <td align="right" style="color: #ffffff !important; font-weight: 700; font-family: 'Courier New', Courier, monospace;">
                    ${userSymbol}${amt.toFixed(2)} <span style="color: #64748b !important; font-weight: 500;">(${percentage}%)</span>
                  </td>
                </tr>
              </table>
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
          <meta name="color-scheme" content="only dark">
          <meta name="supported-color-schemes" content="only dark">
          <title>Daily Statement</title>
          <style>
            :root { color-scheme: only dark; supported-color-schemes: only dark; }
            [data-ogsc] .dark-bg { background-color: #090a0f !important; background-image: linear-gradient(#090a0f, #090a0f) !important; }
            [data-ogsc] .dark-card { background-color: #12141d !important; background-image: linear-gradient(#12141d, #12141d) !important; }
            [data-ogsb] .dark-bg { background-color: #090a0f !important; background-image: linear-gradient(#090a0f, #090a0f) !important; }
            [data-ogsb] .dark-card { background-color: #12141d !important; background-image: linear-gradient(#12141d, #12141d) !important; }
          </style>
        </head>
        <body class="dark-bg" style="margin: 0; padding: 12px 6px; background-color: #090a0f; background-image: linear-gradient(#090a0f, #090a0f); color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          
          <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" class="dark-bg" style="max-width: 440px; margin: 0 auto; background-color: #090a0f; background-image: linear-gradient(#090a0f, #090a0f); border: 1px solid #1e2235; border-top: 3px solid #6366f1; border-radius: 18px; overflow: hidden;">
            
            <!-- Header -->
            <tr>
              <td style="padding: 24px 20px 20px 20px; border-bottom: 1px solid #1a1d2e;">
                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                  <tr>
                    <td align="left" valign="middle" width="52" style="width: 52px;">
                      <img src="https://kfbtsoszcfnoovjvomir.supabase.co/storage/v1/object/public/public-assets/Gemini_Generated_Image_bn2wfabn2wfabn2w.png" width="44" height="44" style="width: 44px; height: 44px; border-radius: 12px; display: block; border: 1px solid #1e2235;" alt="Vault Logo" />
                    </td>
                    <td align="left" valign="middle" style="padding-left: 12px;">
                      <span style="color: #818cf8 !important; font-weight: 800; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; display: block; margin-bottom: 2px;">⚡ VAULT TERMINAL</span>
                      <h2 style="color: #ffffff !important; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.4px;">Daily Statement</h2>
                    </td>
                    <td align="right" valign="top" style="color: #64748b !important; font-size: 11px; font-family: 'Courier New', Courier, monospace; font-weight: 700;">
                      ${uaeYesterdayStr}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Greeting -->
            <tr>
              <td style="padding: 20px 20px 16px 20px; color: #cbd5e1 !important; font-size: 14px; line-height: 1.6;">
                Yo <strong style="color: #ffffff !important;">${user.name}</strong>, Here is the itemized expense breakdown from today:
              </td>
            </tr>

            <!-- Itemized Activity -->
            <tr>
              <td style="padding: 0 20px 16px 20px;">
                <div style="color: #64748b !important; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px;">📅 ITEMIZED ACTIVITY</div>
                ${breakdownHtml}
              </td>
            </tr>

            <!-- Monthly Spending Weight -->
            <tr>
              <td style="padding: 0 20px 16px 20px;">
                <div class="dark-card" style="background-color: #12141d; background-image: linear-gradient(#12141d, #12141d); border: 1px solid #1e2235; padding: 18px 16px; border-radius: 14px;">
                  <div style="color: #818cf8 !important; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 16px;">📊 ${currentMonthLabel} OUTFLOW WEIGHT</div>
                  ${metricsHtml}
                </div>
              </td>
            </tr>

            <!-- Total Metrics -->
            <tr>
              <td style="padding: 0 20px 24px 20px;">
                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                  <tr>
                    <td width="48%" valign="middle" class="dark-card" style="background-color: #12141d; background-image: linear-gradient(#12141d, #12141d); border: 1px solid #1e2235; padding: 14px 10px; border-radius: 12px; text-align: center;">
                      <span style="color: #64748b !important; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px; font-weight: 800;">DAILY OUTFLOW</span>
                      <span style="color: #ffffff !important; font-size: 15px; font-weight: 800; font-family: 'Courier New', Courier, monospace; display: block;">${userSymbol}${totalDailySpend.toFixed(2)}</span>
                    </td>
                    <td width="4%">&nbsp;</td>
                    <td width="48%" valign="middle" class="dark-card" style="background-color: #12141d; background-image: linear-gradient(#12141d, #12141d); border: 1px solid #312e81; padding: 14px 10px; border-radius: 12px; text-align: center;">
                      <span style="color: #818cf8 !important; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px; font-weight: 800;">MTD TOTAL SPEND</span>
                      <span style="color: #34d399 !important; font-size: 15px; font-weight: 800; font-family: 'Courier New', Courier, monospace; display: block;">${userSymbol}${totalMonthlySpend.toFixed(2)}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding: 16px 20px 20px 20px; border-top: 1px solid #1a1d2e; text-align: center;">
                <p style="color: #475569 !important; font-size: 11px; margin: 0; font-weight: 500;">
                  This statement is auto-generated by finance tracker.
                </p>
                <p style="color: #818cf8 !important; font-size: 10px; margin: 6px 0 0 0; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 800;">
                  DESIGNED BY RAHUL
                </p>
              </td>
            </tr>

          </table>

        </body>
        </html>
      `;

      if (process.env.RESEND_API_KEY) {
        await resend.emails.send({
          from: process.env.SENDER_EMAIL || 'Vault Terminal <alerts@drivehouse.ae>',
          to: user.email,
          subject: `Daily Expense Statement - ${uaeYesterdayStr}`,
          html: emailHtmlContent,
        });
        sentCount++;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return res.status(200).json({ success: true, delivered: sentCount, message: 'Daily statements delivered successfully.' });
  } catch (err) {
    console.error("STATEMENT ERROR:", err.message || err);
    return res.status(500).json({ error: err.message || err });
  }
}
