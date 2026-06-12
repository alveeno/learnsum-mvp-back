import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// POST /api/upload  — backend-mediated direct upload to Supabase Storage.
// The caller sends { kind, content_type }; we validate, choose a per-user path
// under "{auth.uid()}/{avatars|posts}/...", and return a short-lived SIGNED
// UPLOAD URL + token (the app uploads the bytes straight to Storage with it,
// e.g. supabase.storage.from('media').uploadToSignedUrl(path, token, file)).
// No service-role key is used — the signed URL is created under the caller's
// own session and the bucket's owner-insert RLS policy (migration 0011).
// ---------------------------------------------------------------------------

const BUCKET = 'media'

// Allowed content types → file extension. Mirrors the bucket's allowed_mime_types.
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
}

const KIND_TO_FOLDER: Record<string, string> = {
  avatar: 'avatars',
  post: 'posts',
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { kind, content_type } = body as { kind?: string; content_type?: string }

  const folder = kind ? KIND_TO_FOLDER[kind] : undefined
  if (!folder) {
    return NextResponse.json({ error: "kind must be one of: avatar, post" }, { status: 400 })
  }

  if (typeof content_type !== 'string' || !MIME_TO_EXT[content_type]) {
    return NextResponse.json(
      { error: `content_type must be one of: ${Object.keys(MIME_TO_EXT).join(', ')}` },
      { status: 400 }
    )
  }

  const ext = MIME_TO_EXT[content_type]
  const path = `${user.id}/${folder}/${randomUUID()}.${ext}`

  // Create a signed upload URL under the caller's session (owner-insert RLS).
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error) {
    console.error('[upload] createSignedUploadUrl error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)

  return NextResponse.json({
    bucket: BUCKET,
    path,
    token: data.token,
    signed_url: data.signedUrl,
    public_url: pub.publicUrl,
    content_type,
    expires_in: 7200, // signed upload URLs are valid for 2 hours
  })
}
