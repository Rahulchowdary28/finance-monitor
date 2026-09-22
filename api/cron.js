import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kfbtsoszcfnoovjvomir.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(RESEND_API_KEY);

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
                            <p style="margin: 6px 0;">?? <strong>Total Influx:</strong> AED ${income.toFixed(2)}</p>
                            <p style="margin: 6px 0; color: #ff4d4d;">?? <strong>Total Outflow:</strong> AED ${expense.toFixed(2)}</p>
                            <p style="margin: 6px 0; color: #00d4ff;">?? <strong>Net Balance Today:</strong> AED ${balance.toFixed(2)}</p>
                            <p style="margin: 6px 0;">?? <strong>Logged Entries:</strong> ${todayTxns.length}</p>
                        </div>
                        <p style="color: #94a3b8; font-size: 0.8rem;">Thank you for staying on top of your financial ledger!</p>
                    </div>
                `;

                const resendResult = await resend.emails.send({
                    from: 'Virtual Vault <onboarding@resend.dev>',
                    to: uEmail,
                    subject: `?? Your Daily Finance Summary - ${now.toLocaleDateString()}`,
                    html: summaryHtml
                });

                if (resendResult.error) {
                    logs.push(`Summary Error for ${uEmail}: ${JSON.stringify(resendResult.error)}`);
                } else {
                    summarySent++;
                    logs.push(`Summary Sent to ${uEmail}`);
                }
            } else {
                const reminderHtml = `
                    <div style="font-family: Arial, sans-serif; background: #040612; color: #fff; padding: 24px; border-radius: 16px; border: 1px solid rgba(0, 212, 255, 0.3);">
                        <h2 style="color: #00d4ff; margin-top: 0;">Record Today's Expenses</h2>
                        <p>Hello <strong>${uName}</strong>,</p>
                        <p>You haven't recorded any transaction entries for today yet.</p>
                        <p>Keep your financial dashboard accurate by logging your daily expenses before the end of the day.</p>
                    </div>
                `;

                const resendResult = await resend.emails.send({
                    from: 'Virtual Vault <onboarding@resend.dev>',
                    to: uEmail,
                    subject: `?? Quick Reminder: Record Today's Expenses`,
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
