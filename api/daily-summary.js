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

    // 1. Time Vector Formulations
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split('T')[0];

    // Formulate Boundary Ranges for Current Month
    const firstDayOfMonth = new Date(yesterday.getFullYear(), yesterday.getMonth(), 1);
    const startOfMonthStr = firstDayOfMonth.toISOString().split('T')[0];

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonthLabel = monthNames[yesterday.getMonth()];

    // 2. Loop Process Core Logic
    for (const user of users) {
      if (!user.email) continue;

      // Fetch DAILY Debits
      const { data: dailyTxns, error: txError } = await supabase
        .from('transactions')
        .select('description, amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${dateString}T00:00:00.000Z`)
        .lte('created_at', `${dateString}T23:59:59.999Z`);

      if (txError) throw txError;

      // Fetch MONTH-TO-DATE Debits
      const { data: monthlyTxns, error: mTxError } = await supabase
        .from('transactions')
        .select('amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${startOfMonthStr}T00:00:00.000Z`)
        .lte('created_at', `${dateString}T23:59:59.999Z`);

      if (mTxError) throw mTxError;

      // Accumulate Financial Summaries
      const totalDailySpend = dailyTxns ? dailyTxns.reduce((sum, t) => sum + parseFloat(t.amount), 0) : 0;
      const totalMonthlySpend = monthlyTxns ? monthlyTxns.reduce((sum, t) => sum + parseFloat(t.amount), 0) : 0;

      // Group Monthly Categories for CSS Distribution Meter
      const categoriesMap = {};
      if (monthlyTxns) {
        monthlyTxns.forEach(t => {
          const amt = parseFloat(t.amount);
          categoriesMap[t.category] = (categoriesMap[t.category] || 0) + amt;
        });
      }

      // Sort categories to display top outflow types
      const sortedCategories = Object.entries(categoriesMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3); // Top 3 tracking arrays

      // Build Daily Rows HTML Markup
      let breakdownHtml = "";
      if (dailyTxns && dailyTxns.length > 0) {
        breakdownHtml = dailyTxns.map(t => `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px 14px; margin-bottom: 8px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div style="text-align: left;">
              <div style="color: #f1f5f9; font-size: 13px; font-weight: 600;">${t.description}</div>
              <span style="display: inline-block; background: rgba(99,102,241,0.15); color: #818cf8; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 500; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${t.category}</span>
            </div>
            <div style="color: #ef4444; font-size: 14px; font-weight: 700; font-family: monospace; text-align: right;">
              - AED ${parseFloat(t.amount).toFixed(2)}
            </div>
          </div>
        `).join('');
      } else {
        breakdownHtml = `
          <div style="text-align: center; color: #64748b; padding: 20px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 10px; font-size: 13px;">
            No outflux events cataloged for this tracking window.
          </div>
        `;
      }

      // Build Monthly Dynamic Visual Analytics Section
      let metricsHtml = "";
      if (totalMonthlySpend > 0 && sortedCategories.length > 0) {
        metricsHtml = sortedCategories.map(([cat, amt]) => {
          const percentage = ((amt / totalMonthlySpend) * 100).toFixed(0);
          return `
            <div style="margin-bottom: 12px; text-align: left;">
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; margin-bottom: 4px;">
                <span style="color: #cbd5e1; font-weight: 500; text-transform: capitalize;">${cat}</span>
                <span style="color: #94a3b8; font-family: monospace;">AED ${amt.toFixed(0)} (${percentage}%)</span>
              </div>
              <div style="width: 100%; background: #1e293b; height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="width: ${percentage}%; background: linear-gradient(90deg, #6366f1, #4f46e5); height: 100%; border-radius: 3px;"></div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        metricsHtml = `<div style="color: #64748b; font-size: 12px; text-align: center;">No visual metrics map generation data available yet.</div>`;
      }

      // Complete Premium Theme Email Structure Layout Template Wrapper
      const emailHtmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 20px; background-color: #040612; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;-webkit-font-smoothing: antialiased;">
          <div style="max-width: 480px; margin: 0 auto; background: #0a0e23; border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
            
            <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 14px; margin-bottom: 18px; text-align: left;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span style="background: #6366f1; width: 8px; height: 8px; border-radius: 50%; display: inline-block; vertical-align: middle;"></span>
                <span style="color: #6366f1; font-weight: 800; font-size: 10px; letter-spacing: 2px; text-transform: uppercase;">VAULT TELEMETRY SYSTEM</span>
              </div>
              <h2 style="color: #f8fafc; margin: 2px 0 0 0; font-size: 19px; font-weight: 700;">Financial Metrics Statement</h2>
            </div>

            <p style="color: #94a3b8; font-size: 14px; margin-bottom: 18px; text-align: left; line-height: 1.5;">
              Hello <strong style="color: #f8fafc;">${user.name}</strong>, processing finished for transaction loop cycle <strong style="color: #818cf8;">${dateString}</strong>:
            </p>

            <div style="margin-bottom: 22px;">
              <h3 style="color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; text-align: left;">Daily Items Matrix</h3>
              ${breakdownHtml}
            </div>

            <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); padding: 16px; border-radius: 12px; margin-bottom: 22px;">
              <h3 style="color: #6366f1; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-top: 0; margin-bottom: 12px; text-align: left;">
                ${currentMonthLabel} Distribution Mix
              </h3>
              ${metricsHtml}
            </div>

            <div style="display: flex; gap: 10px; margin-top: 18px; width: 100%;">
              <div style="flex: 1; min-width: 0; background: #0f172a; border: 1px solid rgba(255,255,255,0.05); padding: 12px; border-radius: 10px; text-align: center;">
                <span style="color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">Daily Outflow</span>
                <span style="color: #f1f5f9; font-size: 15px; font-weight: 700; font-family: monospace;">AED ${totalDailySpend.toFixed(2)}</span>
              </div>
              
              <div style="flex: 1; min-width: 0; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1px solid #4f46e5; padding: 12px; border-radius: 10px; text-align: center;">
                <span style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">MTD Total Spend</span>
                <span style="color: #10b981; font-size: 15px; font-weight: 700; font-family: monospace;">AED ${totalMonthlySpend.toFixed(2)}</span>
              </div>
            </div>

            <div style="margin-top: 28px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 12px;">
              <p style="color: #334155; font-size: 10px; margin: 0;">Automated account sync delivery. Authorized sender encryption sequence verified via alerts@drivehouse.ae.</p>
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

      // Deliberate execution spacing pause protection
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return new Response(JSON.stringify({ success: true, message: 'All telemetry visual statements sent successfully.' }), {
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
