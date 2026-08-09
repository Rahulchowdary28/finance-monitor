import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

webpush.setVapidDetails(
  'mailto:alerts@drivehouse.ae',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export async function POST(request) {
  try {
    const { title, message } = await request.json();

    if (!title || !message) {
      return new Response(JSON.stringify({ error: 'Title and message are required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return await handleBroadcast(title, message);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized security perimeter breach.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return await handleBroadcast('⚡ Vault Terminal Update', 'Check out your updated financial dashboard for today!');
}

async function handleBroadcast(title, message) {
  const { data: users, error: userError } = await supabase
    .from('users_list')
    .select('name, push_subscription')
    .eq('is_hold', false)
    .not('push_subscription', 'is', null);

  if (userError) throw userError;

  const payload = JSON.stringify({
    title: title,
    body: message,
    icon: 'https://kfbtsoszcfnoovjvomir.supabase.co/storage/v1/object/public/public-assets/Gemini_Generated_Image_bn2wfabn2wfabn2w.png'
  });

  let delivered = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.push_subscription) continue;

    try {
      await webpush.sendNotification(user.push_subscription, payload);
      delivered++;
    } catch (pushErr) {
      console.error(`Push failed for ${user.name}:`, pushErr.message);
      failed++;
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      delivered,
      failed,
      totalRecipients: users.length
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
