#!/usr/bin/env python3
"""
Scrape ECMWF Open Data parameter catalog.

Fetches all available parameters from ECMWF Open Data API and generates
a comprehensive params-config.json file with metadata.

Output: config/params-config.json
"""

import json
import urllib.request
import sys
from pathlib import Path

# ECMWF Open Data parameter catalog endpoint
PARAMS_URL = "https://data.ecmwf.int/forecasts/parameters.json"

def fetch_ecmwf_parameters():
    """
    Fetch parameter catalog from ECMWF Open Data API.
    Returns: dict with parameter metadata
    """
    print(f"🔍 Fetching ECMWF parameter catalog...")
    print(f"   URL: {PARAMS_URL}")

    try:
        with urllib.request.urlopen(PARAMS_URL, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            print(f"   ✅ Received {len(data)} parameters")
            return data
    except urllib.error.HTTPError as e:
        print(f"   ❌ HTTP Error {e.code}: {e.reason}")
        sys.exit(1)
    except Exception as e:
        print(f"   ❌ Error: {e}")
        sys.exit(1)

def transform_to_config_format(ecmwf_params):
    """
    Transform ECMWF parameter catalog to our config format.

    Expected ECMWF format (example):
    {
      "2t": {
        "name": "2 metre temperature",
        "units": "K",
        "shortName": "2t"
      }
    }

    Our format:
    {
      "2t": {
        "name": "2 Metre Temperature",
        "description": "Temperature at 2 meters above surface",
        "units": "K",
        "category": "temperature"
      }
    }
    """

    # Category mappings based on parameter prefixes/names
    CATEGORY_MAP = {
        'temperature': ['2t', '2d', 'skt', 'sstk'],
        'wind': ['10u', '10v', '10si', '10wdir'],
        'precipitation': ['tp', 'tprate', 'cp', 'lsp', 'sf', 'ptype'],
        'pressure': ['msl', 'sp', 'tcwv'],
        'cloud': ['tcc', 'lcc', 'mcc', 'hcc'],
        'radiation': ['ssrd', 'strd', 'ssr', 'str'],
        'humidity': ['2d', 'r', 'tcwv'],
        'surface': ['skt', 'stl1', 'swvl1', 'sd', 'rsn'],
        'static': ['lsm', 'z']
    }

    config = {}

    for param_code, param_data in ecmwf_params.items():
        # Determine category
        category = 'other'
        for cat, codes in CATEGORY_MAP.items():
            if param_code in codes:
                category = cat
                break

        # Build config entry
        config[param_code] = {
            'name': param_data.get('name', param_code),
            'description': param_data.get('description', param_data.get('name', '')),
            'units': param_data.get('units', ''),
            'category': category,
            'shortName': param_data.get('shortName', param_code)
        }

    return config

def write_params_config(config_data, output_path):
    """Write params config JSON file"""

    # Sort by category, then by name
    sorted_params = dict(sorted(
        config_data.items(),
        key=lambda x: (x[1]['category'], x[1]['name'])
    ))

    output = {
        '$schema': './schemas/params-config.schema.json',
        'version': '1.0.0',
        'source': 'ECMWF Open Data',
        'updated': None,  # Will be set by generate script
        'parameters': sorted_params
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ Written params config:")
    print(f"   Path: {output_path}")
    print(f"   Parameters: {len(sorted_params)}")

    # Print category summary
    categories = {}
    for param in sorted_params.values():
        cat = param['category']
        categories[cat] = categories.get(cat, 0) + 1

    print(f"\n   Categories:")
    for cat, count in sorted(categories.items()):
        print(f"     {cat}: {count}")

def main():
    print("=" * 60)
    print("ECMWF Parameter Catalog Scraper")
    print("=" * 60)

    # Fetch parameters from ECMWF
    ecmwf_params = fetch_ecmwf_parameters()

    # Transform to our config format
    print("\n🔧 Transforming to config format...")
    config_data = transform_to_config_format(ecmwf_params)

    # Write output file
    output_path = Path(__file__).parent.parent / 'config' / 'params-config.json'
    write_params_config(config_data, output_path)

    print("\n" + "=" * 60)
    return 0

if __name__ == '__main__':
    sys.exit(main())
