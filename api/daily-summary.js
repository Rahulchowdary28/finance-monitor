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
      .select('name, email')
      .eq('is_hold', false);

    if (userError) throw userError;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split('T')[0];

    const firstDayOfMonth = new Date(yesterday.getFullYear(), yesterday.getMonth(), 1);
    const startOfMonthStr = firstDayOfMonth.toISOString().split('T')[0];

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonthLabel = monthNames[yesterday.getMonth()];

    for (const user of users) {
      if (!user.email) continue;

      const { data: dailyTxns, error: txError } = await supabase
        .from('transactions')
        .select('description, amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${dateString}T00:00:00.000Z`)
        .lte('created_at', `${dateString}T23:59:59.999Z`);

      if (txError) throw txError;

      const { data: monthlyTxns, error: mTxError } = await supabase
        .from('transactions')
        .select('amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${startOfMonthStr}T00:00:00.000Z`)
        .lte('created_at', `${dateString}T23:59:59.999Z`);

      if (mTxError) throw mTxError;

      const totalDailySpend = dailyTxns ? dailyTxns.reduce((sum, t) => sum + parseFloat(t.amount), 0) : 0;
      const totalMonthlySpend = monthlyTxns ? monthlyTxns.reduce((sum, t) => sum + parseFloat(t.amount), 0) : 0;

      const categoriesMap = {};
      if (monthlyTxns) {
        monthlyTxns.forEach(t => {
          const amt = parseFloat(t.amount);
          categoriesMap[t.category] = (categoriesMap[t.category] || 0) + amt;
        });
      }

      const sortedCategories = Object.entries(categoriesMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      // REDESIGNED: Premium Itemized Transaction List (Table Layout for clean rendering)
      let breakdownHtml = "";
      if (dailyTxns && dailyTxns.length > 0) {
        breakdownHtml = dailyTxns.map(t => `
          <div style="background: #111632; border: 1px solid rgba(255,255,255,0.06); padding: 14px; margin-bottom: 10px; border-radius: 12px;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td align="left" valign="middle">
                  <div style="color: #ffffff; font-size: 14px; font-weight: 600; font-family: -apple-system, sans-serif;">${t.description}</div>
                  <div style="margin-top: 6px;">
                    <span style="background: rgba(99,102,241,0.15); color: #a5b4fc; font-size: 9px; padding: 3px 8px; border-radius: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; font-family: -apple-system, sans-serif;">
                      📂 ${t.category}
                    </span>
                  </div>
                </td>
                <td align="right" valign="middle" style="color: #ff4a4a; font-size: 16px; font-weight: 700; font-family: 'Courier New', Courier, monospace;">
                  -AED ${parseFloat(t.amount).toFixed(2)}
                </td>
              </tr>
            </table>
          </div>
        `).join('');
      } else {
        breakdownHtml = `
          <div style="text-align: center; color: #4b5563; padding: 30px 20px; border: 2px dashed rgba(255,255,255,0.05); border-radius: 12px; font-size: 14px; font-family: -apple-system, sans-serif;">
            ☕ No transactions logged for this tracking window.
          </div>
        `;
      }

      // REDESIGNED: Enhanced Progress Bars with Glowing Indicators
      let metricsHtml = "";
      if (totalMonthlySpend > 0 && sortedCategories.length > 0) {
        metricsHtml = sortedCategories.map(([cat, amt]) => {
          const percentage = ((amt / totalMonthlySpend) * 100).toFixed(0);
          return `
            <div style="margin-bottom: 16px; font-family: -apple-system, sans-serif;">
              <table width="100%" border="0" cellpadding="0" cellspacing="0" style="font-size: 12px; margin-bottom: 6px;">
                <tr>
                  <td align="left" style="color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${cat}</td>
                  <td align="right" style="color: #f3f4f6; font-weight: 700; font-family: 'Courier New', Courier, monospace;">AED ${amt.toFixed(2)} (${percentage}%)</td>
                </tr>
              </table>
              <div style="width: 100%; background: #1f293d; height: 8px; border-radius: 4px; overflow: hidden;">
                <div style="width: ${percentage}%; background: linear-gradient(90deg, #6366f1, #818cf8); height: 100%; border-radius: 4px; box-shadow: 0 0 8px rgba(99,102,241,0.5);"></div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        metricsHtml = `<div style="color: #4b5563; font-size: 13px; text-align: center; padding: 10px; font-family: -apple-system, sans-serif;">No monthly trend vectors mapped.</div>`;
      }

      // REDESIGNED: Absolute Top-Tier Email Layout Template
      const emailHtmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 30px 10px; background-color: #03040b;">
          <div style="max-width: 460px; margin: 0 auto; background: #070913; border: 1px solid rgba(255,255,255,0.08); border-top: 4px solid #6366f1; border-radius: 16px; padding: 28px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.75);">
            
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 16px; margin-bottom: 24px;">
              <tr>
                <td align="left">
                  <span style="color: #6366f1; font-weight: 800; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; font-family: -apple-system, sans-serif; display: block; margin-bottom: 4px;">⚡ VAULT TERMINAL</span>
                  <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; font-family: -apple-system, sans-serif; letter-spacing: -0.5px;">Daily Statement</h2>
                </td>
                <td align="right" valign="bottom" style="color: #4b5563; font-size: 12px; font-family: 'Courier New', Courier, monospace; font-weight: 700;">
                  ${dateString}
                </td>
              </tr>
            </table>

            <p style="color: #9ca3af; font-size: 14px; line-height: 1.6; font-family: -apple-system, sans-serif; margin-bottom: 24px; text-align: left;">
              System sync complete for user <strong style="color: #ffffff; border-bottom: 1px dashed #6366f1; padding-bottom: 2px;">${user.name}</strong>. Yesterday's itemized asset and expense flows have been processed:
            </p>

            <div style="margin-bottom: 28px;">
              <h3 style="color: #4b5563; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; text-align: left; font-family: -apple-system, sans-serif;">📅 Itemized Activity</h3>
              ${breakdownHtml}
            </div>

            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); padding: 18px; border-radius: 14px; margin-bottom: 28px;">
              <h3 style="color: #818cf8; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 0; margin-bottom: 16px; text-align: left; font-family: -apple-system, sans-serif;">📊 ${currentMonthLabel} Outflow Weight</h3>
              ${metricsHtml}
            </div>

            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
              <tr>
                <td width="48%" valign="top" style="background: #0d1127; border: 1px solid rgba(255,255,255,0.05); padding: 14px; border-radius: 12px; text-align: center;">
                  <span style="color: #4b5563; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; font-family: -apple-system, sans-serif; font-weight: 700;">Daily Outflow</span>
                  <span style="color: #ffffff; font-size: 16px; font-weight: 700; font-family: 'Courier New', Courier, monospace;">AED ${totalDailySpend.toFixed(2)}</span>
                </td>
                <td width="4%">&nbsp;</td>
                <td width="48%" valign="top" style="background: linear-gradient(135deg, #1e1b4b 0%, #0a0c16 100%); border: 1px solid #4f46e5; padding: 14px; border-radius: 12px; text-align: center;">
                  <span style="color: #a5b4fc; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; font-family: -apple-system, sans-serif; font-weight: 700;">MTD Total Spend</span>
                  <span style="color: #10b981; font-size: 16px; font-weight: 700; font-family: 'Courier New', Courier, monospace;">AED ${totalMonthlySpend.toFixed(2)}</span>
                </td>
              </tr>
            </table>

            <div style="margin-top: 36px; text-align: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px;">
              <p style="color: #374151; font-size: 11px; margin: 0; font-family: -apple-system, sans-serif; line-height: 1.4;">
                This statement was auto-generated and safely dispatched via your production domain link structure (<span style="color: #4b5563;">alerts@drivehouse.ae</span>).
              </p>
            </div>

          </div>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: 'Vault Terminal <alerts@drivehouse.ae>', 
        to: user.email,
        subject: `Daily Expense Statement - ${dateString}`,
        html: emailHtmlContent,
      });

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return new Response(JSON.stringify({ success: true, message: 'All luxury ledger dispatches sent successfully.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("CRASH ERROR DETECTED:", err.message || err);
    return new Response(JSON.stringify({ error: err.message || err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
