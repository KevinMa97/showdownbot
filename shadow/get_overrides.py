import json, os, sys
o = {}
if os.environ.get('NOOVR') == '1': print('{}'); sys.exit(0)
for f in ['shadow/overrides50.json', 'shadow/overrides50b.json', 'shadow/overrides50c.json']:
    if os.path.exists(f): o.update(json.load(open(f)))
print(json.dumps(o.get(sys.argv[1], {})))
