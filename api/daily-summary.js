import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Vercel Serverless Cron triggers send a GET request, so we export a named GET function
export async function GET(request) {
  // Security gate check using the standard Web Request API
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized entry matrix.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 1. Pull valid profiles
    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, email')
      .eq('is_hold', false);

    if (userError) throw userError;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split('T')[0];

    // 2. Compute process matrix
    for (const user of users) {
      if (!user.email) continue;

      const { data: txns } = await supabase
        .from('transactions')
        .select('description, amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${dateString}T00:00:00.000Z`)
        .lte('created_at', `${dateString}T23:59:59.999Z`);

      const totalSpend = txns ? txns.reduce((sum, t) => sum + parseFloat(t.amount), 0) : 0;

      let breakdownText = txns && txns.length > 0 
        ? txns.map(t => `• ${t.description} (${t.category}): AED ${parseFloat(t.amount).toFixed(2)}`).join('\n')
        : "No outflow transactions recorded yesterday.";

      // 3. Dispatch payload
      await resend.emails.send({
        from: 'Vault Terminal <ledger@yourdomain.com>', 
        to: user.email,
        subject: `Daily Expense Statement - ${dateString}`,
        text: `Hello ${user.name},\n\nHere is your daily transaction summary for ${dateString}:\n\nTotal Outflow: AED ${totalSpend.toFixed(2)}\n\nBreakdown:\n${breakdownText}\n\n— Virtual Vault Terminal`,
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Ledger system updates delivered.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
