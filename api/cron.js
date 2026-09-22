import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kfbtsoszcfnoovjvomir.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(RESEND_API_KEY);

const SENDER_EMAIL = process.env.SENDER_EMAIL || process.env.RESEND_FROM_EMAIL || 'Vault Terminal <alerts@drivehouse.ae>';

export default async function handler(req, res) {
    const authHeader = req.headers?.authorization || (typeof req.headers?.get === 'function' ? req.headers.get('authorization') : null);
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
        if (res && res.status) return res.status(401).json({ error: 'Unauthorized cron execution' });
        return new Response(JSON.stringify({ error: 'Unauthorized cron execution' }), { status: 401 });
    }

    try {
        const { data: users, error: userErr } = await supabase
            .from('users_list')
            .select('user_id, name, email, is_hold')
            .eq('is_hold', false);

        if (userErr) throw userErr;

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

        let summarySent = 0;
        let nudgeSent = 0;
        let logs = [];

        for (const user of users) {
            if (!user.email) continue;

            const uEmail = user.email.toLowerCase().trim();
            const uName = (user.name || uEmail.split('@')[0]).trim();
            const firstName = uName.split(' ')[0];

            let todayTxns = [];
            const seenTxnIds = new Set();

            if (user.user_id) {
                const { data: byId } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('user_id', user.user_id)
                    .gte('created_at', startOfDay)
                    .lt('created_at', endOfDay);
                if (byId) {
                    byId.forEach(t => { if (!seenTxnIds.has(t.id)) { seenTxnIds.add(t.id); todayTxns.push(t); } });
                }
            }

            if (firstName) {
                const { data: byName } = await supabase
                    .from('transactions')
                    .select('*')
                    .ilike('user_name', `%${firstName}%`)
                    .gte('created_at', startOfDay)
                    .lt('created_at', endOfDay);
                if (byName) {
                    byName.forEach(t => { if (!seenTxnIds.has(t.id)) { seenTxnIds.add(t.id); todayTxns.push(t); } });
                }
            }

            const hasTransactionsToday = todayTxns.length > 0;

            if (hasTransactionsToday) {
                let income = 0;
                let expense = 0;

                todayTxns.forEach(t => {
                    const amt = parseFloat(t.amount || 0);
                    if (t.type === 'credit') income += amt;
                    else if (t.type === 'debit') expense += amt;
                });

                const balance = income - expense;

                const summaryHtml = `
                    <div style="font-family: Arial, sans-serif; background: #040612; color: #fff; padding: 24px; border-radius: 16px; border: 1px solid rgba(0, 255, 136, 0.3);">
                        <h2 style="color: #00ff88; margin-top: 0;">Daily Finance Summary</h2>
                        <p>Hello <strong>${uName}</strong>,</p>
                        <p>Here is your daily activity breakdown for today:</p>
                        <div style="background: rgba(255,255,255,0.05); padding: 16px; border-radius: 12px; margin: 16px 0;">
                            <p style="margin: 6px 0;">📊 <strong>Total Influx:</strong> AED ${income.toFixed(2)}</p>
                            <p style="margin: 6px 0; color: #ff4d4d;">💸 <strong>Total Outflow:</strong> AED ${expense.toFixed(2)}</p>
                            <p style="margin: 6px 0; color: #00d4ff;">💳 <strong>Net Balance Today:</strong> AED ${balance.toFixed(2)}</p>
                            <p style="margin: 6px 0;">📝 <strong>Logged Entries:</strong> ${todayTxns.length}</p>
                        </div>
                        <p style="color: #94a3b8; font-size: 0.8rem;">Thank you for staying on top of your financial ledger!</p>
                    </div>
                `;

                const resendResult = await resend.emails.send({
                    from: SENDER_EMAIL,
                    to: uEmail,
                    subject: `📊 Your Daily Finance Summary - ${now.toLocaleDateString()}`,
                    html: summaryHtml
                });

                if (resendResult.error) {
                    logs.push(`Summary Error for ${uEmail}: ${JSON.stringify(resendResult.error)}`);
                } else {
                    summarySent++;
                    logs.push(`Summary Sent to ${uEmail}`);
                }
            } else {
                const uaeDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
                const reminderHtml = `
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
                                Yo <strong class="text-white" style="color: #ffffff !important; border-bottom: 1px dashed #6366f1; padding-bottom: 1px;">${uName}</strong>, you haven't logged any expenses for today yet.
                              </td>
                            </tr>

                            <!-- CTA Card -->
                            <tr>
                              <td style="padding: 0 20px 20px 20px;">
                                <div class="bg-subcard" style="background-color: #0d1322; background-image: linear-gradient(#0d1322, #0d1322); border: 1px dashed #312e81; padding: 20px 16px; border-radius: 12px; text-align: center;">
                                  <p style="color: #94a3b8 !important; font-size: 13px; margin: 0 0 16px 0; line-height: 1.5;">
                                    Log your daily activity to maintain your spending metrics in <strong>AED</strong> (AED).
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

                const resendResult = await resend.emails.send({
                    from: SENDER_EMAIL,
                    to: uEmail,
                    subject: `📌 Reminder: Add your expenses for ${uaeDateStr}`,
                    html: reminderHtml
                });

                if (resendResult.error) {
                    logs.push(`Reminder Error for ${uEmail}: ${JSON.stringify(resendResult.error)}`);
                } else {
                    nudgeSent++;
                    logs.push(`Reminder Sent to ${uEmail}`);
                }
            }
        }

        const responsePayload = {
            success: true,
            totalUsersProcessed: users.length,
            summaryEmailsSent: summarySent,
            reminderEmailsSent: nudgeSent,
            logs: logs
        };

        if (res && res.status) return res.status(200).json(responsePayload);
        return new Response(JSON.stringify(responsePayload), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
        console.error("Vercel Cron Execution Error:", err);
        if (res && res.status) return res.status(500).json({ error: err.message });
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
