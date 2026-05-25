import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// Initialize your connection services using environment variables
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  // Authorization check to make sure only your Cron trigger can call this function
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized matrix access.' });
  }

  try {
    // 1. Fetch all your active user accounts
    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, email') // Assumes you add an 'email' column to your users_list table
      .eq('is_hold', false);

    if (userError) throw userError;

    // Calculate dates for the preceding 24-hour cycle
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split('T')[0];

    // 2. Loop through users and dispatch their summaries
    for (const user of users) {
      if (!user.email) continue; // Skip profiles without an email address config

      // Fetch only debit entries for this user from yesterday
      const { data: txns } = await supabase
        .from('transactions')
        .select('description, amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${dateString}T00:00:00.000Z`)
        .lte('created_at', `${dateString}T23:59:59.999Z`);

      const totalSpend = txns ? txns.reduce((sum, t) => sum + parseFloat(t.amount), 0) : 0;

      // Construct a clean, scannable text breakdown
      let breakdownText = txns && txns.length > 0 
        ? txns.map(t => `• ${t.description} (${t.category}): AED ${parseFloat(t.amount).toFixed(2)}`).join('\n')
        : "No outflow transactions recorded yesterday.";

      // 3. Send email via Resend
      await resend.emails.send({
        from: 'Vault Terminal <ledger@yourdomain.com>', // Replace with your Resend verified domain
        to: user.email,
        subject: `Daily Expense Statement - ${dateString}`,
        text: `Hello ${user.name},\n\nHere is your daily transaction summary for ${dateString}:\n\nTotal Outflow: AED ${totalSpend.toFixed(2)}\n\nBreakdown:\n${breakdownText}\n\n— Virtual Vault Terminal`,
      });
    }

    return res.status(200).json({ success: true, message: 'Daily ledger delivery dispatched.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
