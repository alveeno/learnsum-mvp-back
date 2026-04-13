import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const { data: categories, error } = await supabase
    .from('categories')
    .select(
      `
      id,
      name_en,
      name_zh,
      slug,
      subcategories (
        id,
        name_en,
        name_zh,
        slug
      )
    `
    )
    .order('name_en')
    .order('name_en', { foreignTable: 'subcategories' })

  if (error) {
    console.error('[categories] Fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ categories })
}
