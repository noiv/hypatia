#!/usr/bin/env node
/**
 * Generate resource manifest from _cache-* marker files
 *
 * Scans public/ directory for _cache-critical, _cache-high, _cache-lazy markers
 * and generates src/manifest.ts with all files and their sizes
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../public');
const OUTPUT_FILE = path.join(__dirname, '../src/manifest.ts');

const PRIORITIES = ['critical', 'high', 'lazy'];

/**
 * Recursively find all directories containing _cache-* markers
 */
function findCacheableDirectories(dir, results = {}) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const fullPath = path.join(dir, entry.name);
      findCacheableDirectories(fullPath, results);
    } else if (entry.name.startsWith('_cache-')) {
      const priority = entry.name.replace('_cache-', '');
      if (PRIORITIES.includes(priority)) {
        if (!results[priority]) {
          results[priority] = [];
        }
        results[priority].push(dir);
      }
    }
  }

  return results;
}

/**
 * Get all files in directory with their sizes
 */
function getFilesWithSizes(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && !entry.name.startsWith('_cache-')) {
      const fullPath = path.join(dir, entry.name);
      const stats = fs.statSync(fullPath);
      const relativePath = '/' + path.relative(PUBLIC_DIR, fullPath).replace(/\\/g, '/');

      files.push({
        path: relativePath,
        size: stats.size
      });
    }
  }

  return files;
}

/**
 * Generate TypeScript manifest file
 */
function generateManifest() {
  console.log('🔍 Scanning for _cache-* markers...');

  const cacheableDirs = findCacheableDirectories(PUBLIC_DIR);
  const manifest = {};

  for (const priority of PRIORITIES) {
    manifest[priority] = [];

    if (cacheableDirs[priority]) {
      console.log(`\n📦 ${priority.toUpperCase()}: Found ${cacheableDirs[priority].length} directories`);

      for (const dir of cacheableDirs[priority]) {
        const files = getFilesWithSizes(dir);
        console.log(`   ${path.relative(PUBLIC_DIR, dir)}: ${files.length} files`);
        manifest[priority].push(...files);
      }
    }
  }

  // Generate TypeScript file
  const content = `/**
 * Resource Manifest
 *
 * Auto-generated from _cache-* marker files
 * DO NOT EDIT MANUALLY - Run 'npm run manifest' to regenerate
 *
 * Generated: ${new Date().toISOString()}
 */

export interface Resource {
  path: string;
  size: number;
}

export interface ResourceManifest {
  critical: Resource[];
  high: Resource[];
  lazy: Resource[];
}

export const RESOURCE_MANIFEST: ResourceManifest = ${JSON.stringify(manifest, null, 2)};

/**
 * Get total size for a priority level
 */
export function getTotalSize(priority: keyof ResourceManifest): number {
  return RESOURCE_MANIFEST[priority].reduce((sum, r) => sum + r.size, 0);
}

/**
 * Get all resources flattened
 */
export function getAllResources(): Resource[] {
  return [
    ...RESOURCE_MANIFEST.critical,
    ...RESOURCE_MANIFEST.high,
    ...RESOURCE_MANIFEST.lazy
  ];
}
`;

  fs.writeFileSync(OUTPUT_FILE, content);

  console.log('\n✅ Generated manifest:');
  console.log(`   Critical: ${manifest.critical.length} files (${formatBytes(manifest.critical.reduce((sum, f) => sum + f.size, 0))})`);
  console.log(`   High: ${manifest.high.length} files (${formatBytes(manifest.high.reduce((sum, f) => sum + f.size, 0))})`);
  console.log(`   Lazy: ${manifest.lazy.length} files (${formatBytes(manifest.lazy.reduce((sum, f) => sum + f.size, 0))})`);
  console.log(`\n📝 Written to: ${path.relative(process.cwd(), OUTPUT_FILE)}`);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Run
try {
  generateManifest();
} catch (error) {
  console.error('❌ Error generating manifest:', error.message);
  process.exit(1);
}
