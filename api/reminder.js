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

  const { searchParams } = new URL(request.url);
  const isDryRun = searchParams.get('dryRun') === 'true' || searchParams.get('test') === 'true';

  try {
    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, email, selected_currency')
      .eq('is_hold', false);

    if (userError) throw userError;

    const uaeDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const emailLog = [];

    for (const user of users) {
      if (!user.email) continue;

      const { data: dailyTxns, error: txError } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${uaeDateStr}T00:00:00+04:00`)
        .lte('created_at', `${uaeDateStr}T23:59:59+04:00`);

      if (txError) throw txError;

      if (dailyTxns && dailyTxns.length > 0) continue;

      emailLog.push({ name: user.name, email: user.email });

      if (!isDryRun) {
        await resend.emails.send({
          from: 'Vault Terminal <alerts@drivehouse.ae>',
          to: user.email,
          subject: `📌 Reminder: Add your expenses for ${uaeDateStr}`,
          html: `<p>Yo ${user.name}, please log your expenses at https://finance-monitor-sigma.vercel.app</p>`,
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun: isDryRun,
        recipientsCount: emailLog.length,
        pendingRecipients: emailLog,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
