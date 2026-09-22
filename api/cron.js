const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kfbtsoszcfnoovjvomir.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(RESEND_API_KEY);

module.exports = async function handler(req, res) {
    const authHeader = req.headers.authorization;
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized cron execution' });
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

        for (const user of users) {
            if (!user.email) continue;

            const uEmail = user.email.toLowerCase();
            const uName = user.name || uEmail.split('@')[0];

            const { data: todayTxns } = await supabase
                .from('transactions')
                .select('*')
                .or(`user_id.eq.${user.user_id},user_name.ilike.%${uName}%`)
                .gte('created_at', startOfDay)
                .lt('created_at', endOfDay);

            const hasTransactionsToday = todayTxns && todayTxns.length > 0;

            if (hasTransactionsToday) {
                // ?? TRANSACTIONS EXIST TODAY -> Send Daily Financial Summary ONLY
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

                await resend.emails.send({
                    from: 'Virtual Vault <onboarding@resend.dev>',
                    to: uEmail,
                    subject: `?? Your Daily Finance Summary - ${now.toLocaleDateString()}`,
                    html: summaryHtml
                });

                summarySent++;
            } else {
                // ?? NO TRANSACTIONS TODAY -> Send "Add Expenses" Reminder
                const reminderHtml = `
                    <div style="font-family: Arial, sans-serif; background: #040612; color: #fff; padding: 24px; border-radius: 16px; border: 1px solid rgba(0, 212, 255, 0.3);">
                        <h2 style="color: #00d4ff; margin-top: 0;">Record Today's Expenses</h2>
                        <p>Hello <strong>${uName}</strong>,</p>
                        <p>You haven't recorded any transaction entries for today yet.</p>
                        <p>Keep your financial dashboard accurate by logging your daily expenses before the end of the day.</p>
                    </div>
                `;

                await resend.emails.send({
                    from: 'Virtual Vault <onboarding@resend.dev>',
                    to: uEmail,
                    subject: `?? Quick Reminder: Record Today's Expenses`,
                    html: reminderHtml
                });

                nudgeSent++;
            }
        }

        return res.status(200).json({
            success: true,
            summaryEmailsSent: summarySent,
            reminderEmailsSent: nudgeSent
        });

    } catch (err) {
        console.error("Vercel Cron Execution Error:", err);
        return res.status(500).json({ error: err.message });
    }
};
