#!/usr/bin/env python3
"""Extract UUIDs from `gmsaas --format json` output.

Tolerant of schema differences across gmsaas versions: it searches the JSON
structure rather than assuming exact key names.

Usage:
  gmsaas --format json recipes list --name X | pick_uuid.py recipe
  gmsaas --format json instances start ... | pick_uuid.py instance
  gmsaas --format json instances list      | pick_uuid.py all-instances
"""
import sys, json

mode = sys.argv[1] if len(sys.argv) > 1 else 'instance'

try:
    data = json.load(sys.stdin)
except Exception:
    print('')
    sys.exit(0)


def first_list_with_uuid(d):
    if isinstance(d, dict):
        for v in d.values():
            if isinstance(v, list) and v and isinstance(v[0], dict) and 'uuid' in v[0]:
                return v
        for v in d.values():
            r = first_list_with_uuid(v)
            if r:
                return r
    return None


def find_uuid(d):
    if isinstance(d, dict):
        inst = d.get('instance')
        if isinstance(inst, dict) and isinstance(inst.get('uuid'), str):
            return inst['uuid']
        if isinstance(d.get('uuid'), str):
            return d['uuid']
        for v in d.values():
            r = find_uuid(v)
            if r:
                return r
    elif isinstance(d, list):
        for v in d:
            r = find_uuid(v)
            if r:
                return r
    return None


if mode == 'recipe':
    lst = first_list_with_uuid(data) or []
    print(lst[0]['uuid'] if lst else '')
elif mode == 'all-instances':
    lst = first_list_with_uuid(data) or []
    print('\n'.join(x['uuid'] for x in lst if isinstance(x, dict) and x.get('uuid')))
else:
    print(find_uuid(data) or '')
