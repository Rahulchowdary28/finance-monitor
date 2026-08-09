import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// 1. Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 2. Helper to configure Web Push lazily with fallback defaults
function initWebPush() {
  const publicKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    'BHaR2ys29miH921MBJ3so73X3LT8MDeYGiRS5l8f1sTD4x8rtQQcSR-CbvfxAjLFi607nQ_Xq239UHuiMX3xA3k';
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    throw new Error(
      `VAPID Key Configuration Error: Public key present (${!!publicKey}), Private key present (${!!privateKey}). Please check your environment variables.`
    );
  }

  webpush.setVapidDetails(
    'mailto:alerts@drivehouse.ae',
    publicKey,
    privateKey
  );
}

// 3. POST Endpoint for manual broadcasts
export async function POST(request) {
  try {
    const { title, message } = await request.json();

    if (!title || !message) {
      return new Response(
        JSON.stringify({ error: 'Title and message are required.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return await handleBroadcast(title, message);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || err }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// 4. GET Endpoint for automated Cron jobs
export async function GET(request) {
  try {
    const authHeader =
      request.headers.get('authorization') ||
      request.headers.get('Authorization');

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized security perimeter breach.' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return await handleBroadcast(
      '⚡ Vault Terminal Update',
      'Check out your updated financial dashboard for today!'
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || err }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// 5. Shared Push Dispatch Logic
async function handleBroadcast(title, message) {
  // Ensure VAPID details are set before processing requests
  initWebPush();

  const { data: users, error: userError } = await supabase
    .from('users_list')
    .select('name, push_subscription')
    .eq('is_hold', false)
    .not('push_subscription', 'is', null);

  if (userError) throw userError;

  const payload = JSON.stringify({
    title: title,
    body: message,
    message: message, // Included for backward compatibility with sw.js
    icon: 'https://kfbtsoszcfnoovjvomir.supabase.co/storage/v1/object/public/public-assets/Gemini_Generated_Image_bn2wfabn2wfabn2w.png'
  });

  let delivered = 0;
  let failed = 0;

  // Process send notifications concurrently for faster execution
  await Promise.all(
    users.map(async (user) => {
      if (!user.push_subscription) return;

      try {
        await webpush.sendNotification(user.push_subscription, payload);
        delivered++;
      } catch (pushErr) {
        console.error(`Push failed for ${user.name}:`, pushErr.message);
        failed++;

        // Auto-clean expired/unsubscribed tokens (HTTP status 404 or 410)
        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
          await supabase
            .from('users_list')
            .update({ push_subscription: null })
            .eq('name', user.name);
        }
      }
    })
  );

  return new Response(
    JSON.stringify({
      success: true,
      delivered,
      failed,
      totalRecipients: users.length
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
