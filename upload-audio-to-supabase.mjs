#!/usr/bin/env node
/**
 * 🔊 Upload Audio Files to Supabase Storage
 * 
 * This script:
 * 1. Deletes old MP3 files from Supabase Storage
 * 2. Uploads new WAV files from public/audio/
 * 
 * Usage: node upload-audio-to-supabase.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, basename, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables from .env.local
function loadEnv() {
  const envPath = join(__dirname, '.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  const env = {}
  
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    
    const [key, ...valueParts] = trimmed.split('=')
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '')
    }
  }
  
  return env
}

const env = loadEnv()
const supabaseUrl = env.VITE_SUPABASE_URL
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables:')
  console.error('   VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '✗')
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗')
  console.error('\nPlease check your .env.local file')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const BUCKET_NAME = 'route-assets'

/**
 * Get all files from a directory recursively
 */
function getAllFiles(dir, basePath = '') {
  const files = []
  const items = readdirSync(dir)

  for (const item of items) {
    const fullPath = join(dir, item)
    const stat = statSync(fullPath)
    const relativePath = basePath ? `${basePath}/${item}` : item

    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, relativePath))
    } else if (stat.isFile()) {
      files.push({ fullPath, relativePath })
    }
  }

  return files
}

/**
 * Delete old MP3 audio files from Supabase Storage
 */
async function deleteOldAudioFiles() {
  console.log('\n🗑️  Deleting old MP3 files from Supabase Storage...\n')

  try {
    // List all files in the audio folder
    const { data: audioFiles, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list('audio', { limit: 1000 })

    if (listError) {
      console.error('❌ Error listing audio files:', listError.message)
      return
    }

    // Filter MP3 files
    const mp3Files = audioFiles.filter(file => file.name.endsWith('.mp3'))
    
    if (mp3Files.length === 0) {
      console.log('✓ No MP3 files found in audio/ folder')
    } else {
      console.log(`Found ${mp3Files.length} MP3 files to delete:`)
      mp3Files.forEach(f => console.log(`   - ${f.name}`))

      // Delete each MP3 file
      for (const file of mp3Files) {
        const { error } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([`audio/${file.name}`])

        if (error) {
          console.error(`❌ Error deleting audio/${file.name}:`, error.message)
        } else {
          console.log(`✓ Deleted audio/${file.name}`)
        }
      }
    }

    // List all files in the audio/points folder
    const { data: pointFiles, error: pointListError } = await supabase.storage
      .from(BUCKET_NAME)
      .list('audio/points', { limit: 1000 })

    if (pointListError) {
      console.error('❌ Error listing audio/points files:', pointListError.message)
      return
    }

    // Filter MP3 files
    const pointMp3Files = pointFiles.filter(file => file.name.endsWith('.mp3'))
    
    if (pointMp3Files.length === 0) {
      console.log('✓ No MP3 files found in audio/points/ folder')
    } else {
      console.log(`\nFound ${pointMp3Files.length} MP3 files in points/ to delete:`)
      pointMp3Files.forEach(f => console.log(`   - ${f.name}`))

      // Delete each MP3 file
      for (const file of pointMp3Files) {
        const { error } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([`audio/points/${file.name}`])

        if (error) {
          console.error(`❌ Error deleting audio/points/${file.name}:`, error.message)
        } else {
          console.log(`✓ Deleted audio/points/${file.name}`)
        }
      }
    }

    console.log('\n✅ Cleanup complete!\n')
  } catch (error) {
    console.error('❌ Unexpected error during cleanup:', error)
  }
}

/**
 * Upload new WAV files to Supabase Storage
 */
async function uploadNewAudioFiles() {
  console.log('🔊 Uploading new WAV files to Supabase Storage...\n')

  const audioDir = join(__dirname, 'public', 'audio')
  const files = getAllFiles(audioDir)

  // Filter only WAV files
  const wavFiles = files.filter(f => extname(f.relativePath).toLowerCase() === '.wav')

  if (wavFiles.length === 0) {
    console.log('⚠️  No WAV files found in public/audio/')
    return
  }

  console.log(`Found ${wavFiles.length} WAV files to upload:\n`)

  let uploaded = 0
  let skipped = 0
  let errors = 0

  for (const file of wavFiles) {
    const storagePath = `audio/${file.relativePath}`
    const fileBuffer = readFileSync(file.fullPath)

    try {
      // Check if file already exists
      const { data: existingFile } = await supabase.storage
        .from(BUCKET_NAME)
        .list(dirname(storagePath).replace(/\\/g, '/'), {
          search: basename(file.relativePath)
        })

      if (existingFile && existingFile.length > 0) {
        console.log(`⏭️  Skipped (exists): ${storagePath}`)
        skipped++
        continue
      }

      // Upload the file
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, fileBuffer, {
          contentType: 'audio/wav',
          cacheControl: '31536000', // 1 year
          upsert: false
        })

      if (error) {
        console.error(`❌ Error uploading ${storagePath}:`, error.message)
        errors++
      } else {
        console.log(`✓ Uploaded: ${storagePath}`)
        uploaded++
      }
    } catch (error) {
      console.error(`❌ Unexpected error with ${storagePath}:`, error.message)
      errors++
    }
  }

  console.log('\n📊 Upload Summary:')
  console.log(`   ✅ Uploaded: ${uploaded}`)
  console.log(`   ⏭️  Skipped: ${skipped}`)
  console.log(`   ❌ Errors: ${errors}`)
}

/**
 * Main execution
 */
async function main() {
  console.log('╔════════════════════════════════════════════════╗')
  console.log('║  🔊 Audio Upload to Supabase Storage          ║')
  console.log('╚════════════════════════════════════════════════╝')

  await deleteOldAudioFiles()
  await uploadNewAudioFiles()

  console.log('\n✅ All done!\n')
}

main().catch(console.error)
