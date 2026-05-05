#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
cd /Users/evan/projects/mapick/mapick

echo "========================================="
echo "PHASE 2 QA TEST EXECUTION"
echo "========================================="
echo ""

# F1: proactive_mode
echo "### F1: proactive_mode ###"
echo ""
echo "=== F1.1: Set proactive_mode ==="
node scripts/shell.js profile set proactive_mode=silent | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('intent'), d.get('mode'))"

echo ""
echo "=== F1.2: Get proactive_mode ==="
node scripts/shell.js profile get | python3 -c "import sys,json; d=json.load(sys.stdin); print('mode:', d.get('proactive_mode','not set'))"

echo ""
echo "=== F1.3: Set back to helpful ==="
node scripts/shell.js profile set proactive_mode=helpful | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('intent'), d.get('mode'))"

echo ""
echo "========================================="
echo ""

# F2: Token tracking
echo "### F2: Token tracking ###"
echo ""
echo "=== F2.1: token today ==="
node scripts/shell.js stats token today | python3 -c "import sys,json; d=json.load(sys.stdin); print('intent:', d.get('intent'), '| sessions:', d.get('sessions','?'), '| total:', d.get('total','?'))"

echo ""
echo "=== F2.2: token week ==="
node scripts/shell.js stats token week | python3 -c "import sys,json; d=json.load(sys.stdin); print('intent:', d.get('intent'), '| sessions:', d.get('sessions','?'))"

echo ""
echo "========================================="
echo ""

# F3: Contextual recommendations
echo "### F3: Contextual recommendations ###"
echo ""
echo "=== F3.1: recommend --contextual ==="
node scripts/shell.js recommend 2 --contextual | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('intent:', d.get('intent'), '| items:', len(d.get('items',[])), '| contextual:', d.get('contextual', 'MISSING'))
for i in d.get('items',[])[:3]:
    print('  -', i.get('skillName','?'))
"

echo ""
echo "=== F3.2: recommend (default, no regression) ==="
node scripts/shell.js recommend 2 | python3 -c "import sys,json; d=json.load(sys.stdin); print('intent:', d.get('intent'), '| items:', len(d.get('items',[])))"

echo ""
echo "========================================="
echo ""

# Core regression
echo "### Core regression tests ###"
echo ""
echo "=== Regression: status ==="
node scripts/shell.js status | python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS' if d.get('has_backend') else 'FAIL')"

echo ""
echo "=== Regression: privacy ==="
node scripts/shell.js privacy status | python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS' if d.get('mode') else 'FAIL')"

echo ""
echo "=== Regression: security ==="
node scripts/shell.js security "../../etc" | python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS' if d.get('error')=='invalid_skill_id' else 'FAIL')"

echo ""
echo "=== All modules parse ==="
for f in core misc recommend radar http token; do
    node -e "require('./scripts/lib/${f}.js')" 2>&1 && echo "PASS: $f" || echo "FAIL: $f"
done

echo ""
echo "========================================="
echo "TEST EXECUTION COMPLETE"
echo "========================================="