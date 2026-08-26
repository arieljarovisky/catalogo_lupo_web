require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
// Claves nuevas (sb_secret_...) o legacy service_role (eyJ...)
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';
const UPLOADS_BUCKET = process.env.SUPABASE_UPLOADS_BUCKET || 'uploads';

const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);

let client = null;

function getClient() {
  if (!USE_SUPABASE) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

async function fetchAppState() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('app_state')
    .select('data')
    .eq('id', 'main')
    .maybeSingle();
  if (error) throw new Error(`Supabase app_state: ${error.message}`);
  return data?.data || null;
}

async function upsertAppState(payload) {
  const supabase = getClient();
  const { error } = await supabase
    .from('app_state')
    .upsert({
      id: 'main',
      data: payload,
      updated_at: new Date().toISOString()
    });
  if (error) throw new Error(`Supabase save app_state: ${error.message}`);
}

async function uploadPublicFile(objectPath, buffer, contentType) {
  const supabase = getClient();
  const { error } = await supabase.storage
    .from(UPLOADS_BUCKET)
    .upload(objectPath, buffer, {
      contentType,
      upsert: true
    });
  if (error) throw new Error(`Supabase storage upload: ${error.message}`);
  const { data } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

function storagePathFromPublicUrl(url) {
  const value = String(url || '');
  const marker = `/storage/v1/object/public/${UPLOADS_BUCKET}/`;
  const idx = value.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(value.slice(idx + marker.length).split('?')[0]);
}

async function removePublicFile(urlOrPath) {
  const supabase = getClient();
  const objectPath = storagePathFromPublicUrl(urlOrPath) || String(urlOrPath || '').replace(/^\/+/, '');
  if (!objectPath || objectPath.includes('..')) return;
  const { error } = await supabase.storage.from(UPLOADS_BUCKET).remove([objectPath]);
  if (error) console.warn('Supabase storage delete:', error.message);
}

async function saveOrder(token, filename, content) {
  const supabase = getClient();
  const { error } = await supabase.from('orders').upsert({
    token,
    filename,
    content,
    created_at: new Date().toISOString()
  });
  if (error) throw new Error(`Supabase save order: ${error.message}`);
}

async function getOrder(token) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('orders')
    .select('token, filename, content')
    .eq('token', token)
    .maybeSingle();
  if (error) throw new Error(`Supabase get order: ${error.message}`);
  return data || null;
}

module.exports = {
  USE_SUPABASE,
  UPLOADS_BUCKET,
  getClient,
  fetchAppState,
  upsertAppState,
  uploadPublicFile,
  removePublicFile,
  storagePathFromPublicUrl,
  saveOrder,
  getOrder
};
