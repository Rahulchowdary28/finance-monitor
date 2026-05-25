import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized entry matrix.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 1. Pull active profiles
    const { data: users, error: userError } = await supabase
      .from('users_list')
      .select('name, email')
      .eq('is_hold', false);

    if (userError) throw userError;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split('T')[0];

    // 2. Process each user's matrix
    for (const user of users) {
      if (!user.email) continue;

      const { data: txns, error: txError } = await supabase
        .from('transactions')
        .select('description, amount, category')
        .eq('user_name', user.name)
        .eq('type', 'debit')
        .gte('created_at', `${dateString}T00:00:00.000Z`)
        .lte('created_at', `${dateString}T23:59:59.999Z`);

      if (txError) throw txError;

      const totalSpend = txns ? txns.reduce((sum, t) => sum + parseFloat(t.amount), 0) : 0;

      // Format individual ledger rows dynamically using HTML styling matching your app's UI colors
      let breakdownHtml = "";
      if (txns && txns.length > 0) {
        breakdownHtml = txns.map(t => `
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="color: #f8fafc; font-size: 14px; font-weight: 600;">${t.description}</div>
              <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase; margin-top: 2px; letter-spacing: 0.5px;">${t.category}</div>
            </div>
            <div style="color: #ff4d4d; font-size: 15px; font-weight: 700; font-family: monospace;">
              - AED ${parseFloat(t.amount).toFixed(2)}
            </div>
          </div>
        `).join('');
      } else {
        breakdownHtml = `
          <div style="text-align: center; color: #94a3b8; padding: 24px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 8px; font-size: 14px;">
            No outflow transactions recorded for this cycle.
          </div>
        `;
      }

      // Premium UI HTML Wrapper
      const emailHtmlContent = `
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 20px; background-color: #040612; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width: 500px; margin: 0 auto; background: #0d1127; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            
            <div style="border-bottom: 1px solid rgba(255,255,255,0.07); padding-bottom: 16px; margin-bottom: 20px;">
              <span style="color: #6366f1; font-weight: 800; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; display: block;">VIRTUAL VAULT TERMINAL</span>
              <h2 style="color: #f8fafc; margin: 4px 0 0 0; font-size: 20px; font-weight: 700;">Daily Spend Analytics</h2>
              <span style="color: #94a3b8; font-size: 13px; display: block; margin-top: 4px;">Statement Period: ${dateString}</span>
            </div>

            <p style="color: #f8fafc; font-size: 15px; margin-bottom: 20px;">Hello <strong style="color: #6366f1;">${user.name}</strong>, here is your structural accounting breakdown for yesterday:</p>

            <div style="margin-bottom: 24px;">
              <h3 style="color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Itemized Ledger</h3>
              ${breakdownHtml}
            </div>

            <div style="background: linear-gradient(135deg, #1e1b4b 0%, #0d1127 100%); border: 1px solid #6366f1; padding: 16px; border-radius: 12px; text-align: center; margin-top: 24px;">
              <span style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px;">Total Accumulated Spend</span>
              <span style="color: #00ff88; font-size: 26px; font-weight: 800; font-family: monospace;">AED ${totalSpend.toFixed(2)}</span>
            </div>

            <div style="margin-top: 32px; text-align: center; border-top: 1px solid rgba(255,255,255,0.07); padding-top: 16px;">
              <p style="color: #52627a; font-size: 11px; margin: 0;">This is an automated system ledger delivery tracking environment.</p>
            </div>

          </div>
        </body>
        </html>
      `;

      // 3. Dispatch Premium HTML Payload
      await resend.emails.send({
        from: 'Vault Terminal <onboarding@resend.dev>', 
        to: user.email,
        subject: `Daily Expense Statement - ${dateString}`,
        html: emailHtmlContent, // Changed from 'text' to 'html'
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Premium ledger system updates delivered.' }), {
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
