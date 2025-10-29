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
 * Parse timestamp from data filename (e.g., "20251029_12z.bin" -> ISO timestamp)
 */
function parseDataTimestamp(filename) {
  const match = filename.match(/^(\d{8})_(\d{2})z\.bin$/);
  if (!match) return null;

  const [, dateStr, hourStr] = match;
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1; // JS months are 0-indexed
  const day = parseInt(dateStr.substring(6, 8));
  const hour = parseInt(hourStr);

  return new Date(Date.UTC(year, month, day, hour)).toISOString();
}

/**
 * Scan data directories and extract time ranges
 */
function scanDataDirectories() {
  const dataDir = path.join(PUBLIC_DIR, 'data');
  if (!fs.existsSync(dataDir)) {
    return {};
  }

  const datasets = {};
  const entries = fs.readdirSync(dataDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
      const datasetDir = path.join(dataDir, entry.name);
      const files = fs.readdirSync(datasetDir);

      // Find all .bin files and extract timestamps
      const timestamps = files
        .filter(f => f.endsWith('.bin'))
        .map(f => parseDataTimestamp(f))
        .filter(t => t !== null)
        .sort();

      if (timestamps.length > 0) {
        datasets[entry.name] = {
          startTime: timestamps[0],
          endTime: timestamps[timestamps.length - 1],
          count: timestamps.length
        };
      }
    }
  }

  return datasets;
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

  // Scan data directories for time ranges
  console.log('\n🗂️  Scanning data directories...');
  const datasets = scanDataDirectories();

  for (const [name, info] of Object.entries(datasets)) {
    console.log(`   ${name}: ${info.count} timesteps (${info.startTime} to ${info.endTime})`);
  }

  // Generate TypeScript file
  const content = `/**
 * Resource Manifest
 *
 * Auto-generated from _cache-* marker files and data directories
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

export interface DatasetInfo {
  startTime: string; // ISO 8601 timestamp
  endTime: string;   // ISO 8601 timestamp
  count: number;     // Number of timesteps
}

export interface DataManifest {
  [dataset: string]: DatasetInfo;
}

export const RESOURCE_MANIFEST: ResourceManifest = ${JSON.stringify(manifest, null, 2)};

export const DATA_MANIFEST: DataManifest = ${JSON.stringify(datasets, null, 2)};

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

/**
 * Get time range for a dataset
 */
export function getDatasetRange(dataset: keyof DataManifest): { startTime: Date; endTime: Date } | null {
  const info = DATA_MANIFEST[dataset];
  if (!info) return null;

  return {
    startTime: new Date(info.startTime),
    endTime: new Date(info.endTime)
  };
}
`;

  fs.writeFileSync(OUTPUT_FILE, content);

  console.log('\n✅ Generated manifest:');
  console.log(`   Critical: ${manifest.critical.length} files (${formatBytes(manifest.critical.reduce((sum, f) => sum + f.size, 0))})`);
  console.log(`   High: ${manifest.high.length} files (${formatBytes(manifest.high.reduce((sum, f) => sum + f.size, 0))})`);
  console.log(`   Lazy: ${manifest.lazy.length} files (${formatBytes(manifest.lazy.reduce((sum, f) => sum + f.size, 0))})`);
  console.log(`   Datasets: ${Object.keys(datasets).length} found`);
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
