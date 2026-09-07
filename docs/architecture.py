"""Render the Cosign architecture diagram in light and dark variants.

Usage:  python3 docs/architecture.py docs

Writes architecture-light.svg and architecture-dark.svg. The PNGs committed
beside them come from headless Chrome at 2x:

    chrome --headless=new --force-device-scale-factor=2 \\
           --window-size=1180,1370 --screenshot=architecture-light.png <svg>
"""
import io, sys

W, H = 1180, 1370

LIGHT = dict(
    name='light',
    bg='#ffffff', zone='#f6f8fa', zone_line='#d8dee4', card='#ffffff', card_line='#d0d7de',
    text='#1f2328', muted='#59636e', faint='#818b98',
    edge='#d0651a', agent='#8250df', check='#9a6700', judge='#0969da',
    ok='#1a7f37', bad='#cf222e', chain='#1a7f37', sentry='#6b46c1',
    ok_bg='#e9f6ec', bad_bg='#fdedee', check_bg='#fdf5e2', judge_bg='#eaf1fb',
    agent_bg='#f4eefe', chip='#eef1f4', arrow='#8c959f',
)
DARK = dict(
    name='dark',
    bg='#0d1117', zone='#151b23', zone_line='#2c333b', card='#0d1117', card_line='#3d444d',
    text='#e6edf3', muted='#9198a1', faint='#6d757e',
    edge='#f0883e', agent='#a371f7', check='#d29922', judge='#58a6ff',
    ok='#3fb950', bad='#f85149', chain='#3fb950', sentry='#a78bfa',
    ok_bg='#12261a', bad_bg='#2a1416', check_bg='#241c0c', judge_bg='#0d1d33',
    agent_bg='#1b1229', chip='#1c232b', arrow='#6d757e',
)

SANS = "-apple-system,'SF Pro Text','Helvetica Neue',Arial,sans-serif"
MONO = "'SF Mono',Menlo,'Courier New',monospace"

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

class Svg:
    def __init__(self, p):
        self.p = p
        self.o = []
    def add(self, s): self.o.append(s)
    def rect(self, x, y, w, h, fill, stroke=None, r=8, sw=1, dash=None, op=None):
        a = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'
        if stroke: a += f' stroke="{stroke}" stroke-width="{sw}"'
        if dash: a += f' stroke-dasharray="{dash}"'
        if op: a += f' opacity="{op}"'
        self.add(a + '/>')
    def text(self, x, y, s, size=12, fill=None, weight='400', anchor='start', font=SANS, ls=None, op=None):
        a = f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" fill="{fill or self.p["text"]}" text-anchor="{anchor}"'
        if ls: a += f' letter-spacing="{ls}"'
        if op: a += f' opacity="{op}"'
        self.add(a + f'>{esc(s)}</text>')
    def line(self, x1, y1, x2, y2, stroke=None, sw=1.5, dash=None, cap='round'):
        a = f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke or self.p["arrow"]}" stroke-width="{sw}" stroke-linecap="{cap}"'
        if dash: a += f' stroke-dasharray="{dash}"'
        self.add(a + '/>')
    def arrow(self, x1, y1, x2, y2, stroke=None, sw=1.6, marker='a'):
        c = stroke or self.p['arrow']
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="{sw}" marker-end="url(#{marker})"/>')
    def path(self, d, stroke=None, sw=1.6, fill='none', marker=None, dash=None):
        a = f'<path d="{d}" fill="{fill}" stroke="{stroke or self.p["arrow"]}" stroke-width="{sw}" stroke-linejoin="round"'
        if marker: a += f' marker-end="url(#{marker})"'
        if dash: a += f' stroke-dasharray="{dash}"'
        self.add(a + '/>')
    def dot(self, cx, cy, r, fill):
        self.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/>')

def zone(s, x, y, w, h, label, sub=None):
    p = s.p
    s.rect(x, y, w, h, p['zone'], p['zone_line'], r=12)
    s.text(x + 18, y + 24, label, size=10.5, fill=p['faint'], weight='700', ls='1.4')
    if sub:
        s.text(x + 18, y + 41, sub, size=11, fill=p['muted'])

def card(s, x, y, w, h, lines, accent=None, bg=None, line=None, pad=14):
    p = s.p
    s.rect(x, y, w, h, bg or p['card'], line or p['card_line'], r=8)
    if accent:
        s.rect(x, y, 3.2, h, accent, r=1.6)
    cy = y + pad
    for (txt, size, fill, weight, font, gap) in lines:
        cy += size
        s.text(x + pad + (3 if accent else 0), cy, txt, size=size, fill=fill, weight=weight, font=font)
        cy += gap
    return cy

def build(p):
    s = Svg(p)
    s.add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
    s.add('<defs>')
    for key, cid in [('arrow', 'a'), ('ok', 'aok'), ('bad', 'abad'), ('agent', 'aag'), ('check', 'ack'), ('judge', 'ajd')]:
        s.add(f'<marker id="{cid}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
              f'<path d="M 0 1 L 9 5 L 0 9 z" fill="{p[key]}"/></marker>')
    s.add('</defs>')
    s.rect(0, 0, W, H, p['bg'], r=0)

    M = 24
    CW = 986          # main column width
    CX = M            # main column x
    CR = CX + CW      # 1010
    MID = CX + CW / 2 # 517

    # ---------- header ----------
    s.text(M, 34, 'Cosign', size=17, weight='700')
    s.text(M + 66, 34, 'verify-then-settle, end to end', size=13, fill=p['muted'])
    legend = [('check', 'deterministic code'), ('judge', 'model judgement'), ('agent', 'seller agents'), ('chain', 'on-chain')]
    widths = {'deterministic code': 104, 'model judgement': 98, 'seller agents': 80, 'on-chain': 54}
    total = sum(widths[t] + 16 for _, t in legend) + 18 * (len(legend) - 1)
    lx = (M + CW + 130 + 16) - total
    for key, label in legend:
        s.dot(lx + 4, 30, 4.2, p[key])
        s.text(lx + 15, 34, label, size=10.5, fill=p['muted'])
        lx += widths[label] + 16 + 18

    # ---------- 1. browser ----------
    y1 = 58
    zone(s, CX, y1, CW, 78, 'BROWSER')
    card(s, CX + 18, y1 + 30, 288, 34, [('React dashboard', 12.5, p['text'], '600', SANS, 0)], pad=10)
    s.text(CX + 324, y1 + 48, 'Vite bundle served by the Worker. Live task feed, evidence viewer,', size=11, fill=p['muted'])
    s.text(CX + 324, y1 + 63, 'Session Replay and browser source maps uploaded on every build.', size=11, fill=p['muted'])
    b1 = y1 + 78

    s.arrow(MID, b1, MID, b1 + 26)
    s.text(MID + 10, b1 + 18, 'HTTPS  /api/*', size=10, fill=p['faint'], font=MONO)

    # ---------- 2. cloudflare ----------
    y2 = b1 + 26
    zh = 268
    zone(s, CX, y2, CW, zh, 'CLOUDFLARE WORKERS')
    row = y2 + 36
    boxes = [
        (CX + 18, 300, 'Worker API', 'router, auth, SSE stream'),
        (CX + 332, 196, 'KV', 'demo configuration'),
        (CX + 542, 210, 'Board DO', 'cross-task index'),
        (CX + 766, 202, 'Static assets', 'dist/ from Vite'),
    ]
    for bx, bw, t, sub in boxes:
        card(s, bx, row, bw, 54, [
            (t, 12.5, p['text'], '600', SANS, 3),
            (sub, 10.5, p['muted'], '400', SANS, 0),
        ], accent=p['edge'], pad=11)
    s.arrow(CX + 168, row + 54, CX + 168, row + 78, stroke=p['edge'], marker='a')
    s.text(CX + 180, row + 71, 'one Durable Object per task', size=10, fill=p['faint'], font=MONO)

    # task DO
    ty = row + 78
    th = 128
    s.rect(CX + 18, ty, CW - 36, th, p['card'], p['card_line'], r=10)
    s.rect(CX + 18, ty, 3.2, th, p['edge'], r=1.6)
    s.text(CX + 36, ty + 24, 'Task Durable Object', size=12.5, weight='600')
    s.text(CX + 178, ty + 24, 'SQLite storage, alarm-driven phase machine', size=11, fill=p['muted'])
    phases = ['classify', 'initialize', 'decompose', 'sellers', 'verify', 'reconcile', 'settle', 'complete']
    inner = CW - 36 - 36
    gap = 14
    cw = (inner - gap * (len(phases) - 1)) / len(phases)
    px = CX + 36
    for i, ph in enumerate(phases):
        s.rect(px, ty + 40, cw, 28, p['chip'], r=6)
        s.text(px + cw / 2, ty + 58, ph, size=9.5, fill=p['muted'], anchor='middle', font=MONO)
        if i < len(phases) - 1:
            s.text(px + cw + gap / 2, ty + 58.5, '›', size=12, fill=p['faint'], anchor='middle')
        px += cw + gap
    s.text(CX + 36, ty + 90, 'Every phase persists before the alarm returns, so a restart resumes mid-run instead of starting over.', size=11, fill=p['muted'])
    s.text(CX + 36, ty + 108, 'An unavailable service is retried three times, then the task pauses rather than inventing a result.', size=11, fill=p['muted'])
    b2 = y2 + zh

    s.arrow(MID, b2, MID, b2 + 26, stroke=p['agent'])

    # ---------- 3. research panel ----------
    y3 = b2 + 26
    zh3 = 176
    zone(s, CX, y3, CW, zh3, 'RESEARCH PANEL',
         'Four models, four research strategies, separate tool budgets — one provider, so this is strategy diversity, not model-family independence.')
    agents = [
        ('AGENT 1', 'gpt-4.1-mini', 'Primary and official sources only', '6 tool calls · temp 0.2'),
        ('AGENT 2', 'gpt-4o-mini', 'Audits every number, date and unit', '8 tool calls · temp 0.8'),
        ('AGENT 3', 'gpt-5-mini', 'Independent, unaffiliated corroboration', '8 tool calls'),
        ('AGENT 4', 'gpt-4o', 'Adversarial: searches for the refutation', '10 tool calls · temp 0.6'),
    ]
    ay = y3 + 54
    inner = CW - 36
    gap = 14
    aw = (inner - gap * 3) / 4
    ax = CX + 18
    for tag, model, lens, budget in agents:
        card(s, ax, ay, aw, 92, [
            (tag, 9, p['agent'], '700', MONO, 5),
            (model, 12, p['text'], '600', MONO, 6),
            (lens, 10.5, p['muted'], '400', SANS, 3),
            (budget, 9.5, p['faint'], '400', MONO, 0),
        ], accent=p['agent'], bg=p['agent_bg'], line=p['card_line'], pad=12)
        ax += aw + gap
    s.text(CX + 18, y3 + zh3 - 14, 'Each seller runs the Responses API with web search and returns a verdict, per-sub-claim answers, sources and exact quotes. 2–4 are staffed per task. Nothing they say is trusted yet.', size=11, fill=p['muted'])
    b3 = y3 + zh3

    s.arrow(MID, b3, MID, b3 + 26, stroke=p['check'])
    s.text(MID + 10, b3 + 18, 'claim · sources · quotes', size=10, fill=p['faint'], font=MONO)

    # ---------- 4. evidence pipeline ----------
    y4 = b3 + 26
    zh4 = 214
    zone(s, CX, y4, CW, zh4, 'EVIDENCE PIPELINE',
         'Runs server-side, outside the agents’ control. Deterministic code, no model in the loop.')
    sy = y4 + 54
    inner = CW - 36
    gap = 14
    sw = (inner - gap * 2) / 3
    steps = [
        ('Retrieve', 'Fetch every cited URL, extract text, hash it, index it'),
        ('Ground', 'Quote must reach 0.75 three-gram containment in that page'),
        ('Blind', 'Strip seller identity, sort sources, shuffle review order'),
    ]
    sx = CX + 18
    for t, sub in steps:
        card(s, sx, sy, sw, 56, [
            (t, 12.5, p['text'], '600', SANS, 4),
            (sub, 10.5, p['muted'], '400', SANS, 0),
        ], accent=p['check'], bg=p['check_bg'], pad=11)
        sx += sw + gap
    st = [
        ('grounded', p['ok'], p['ok_bg'], 'quote found — counts toward payment'),
        ('contradicted', p['check'], p['check_bg'], 'page real, quote absent — no credit'),
        ('nonexistent', p['bad'], p['bad_bg'], '404 — fabrication, vetoes the payout'),
        ('unverifiable', p['faint'], p['chip'], '403 or PDF — not held against the seller'),
    ]
    cy = sy + 72
    gap = 12
    cwid = (inner - gap * 3) / 4
    cx = CX + 18
    for name, col, bg, sub in st:
        s.rect(cx, cy, cwid, 52, bg, p['card_line'], r=8)
        s.dot(cx + 15, cy + 20, 4, col)
        s.text(cx + 26, cy + 24, name, size=11, fill=col, weight='600', font=MONO)
        s.text(cx + 13, cy + 41, sub, size=9.8, fill=p['muted'])
        cx += cwid + gap
    s.text(CX + 18, y4 + zh4 - 14, 'A 404 is fraud; a 403 or a PDF is infrastructure. Separating the two is why honest sellers still get paid.', size=11, fill=p['muted'])
    b4 = y4 + zh4

    s.arrow(MID, b4, MID, b4 + 26, stroke=p['judge'])

    # ---------- 5. verification ----------
    y5 = b4 + 26
    zh5 = 240
    zone(s, CX, y5, CW, zh5, 'BLIND VERIFICATION', 'Reviewers never see who produced the submission, or what anyone else concluded.')
    vy = y5 + 54
    card(s, CX + 18, vy, 258, 106, [
        ('Elasticsearch', 12.5, p['text'], '600', SANS, 6),
        ('Run-scoped index of the', 10.5, p['muted'], '400', SANS, 2),
        ('retrieved page text.', 10.5, p['muted'], '400', SANS, 6),
        ('BM25 + dense vectors, RRF', 9.8, p['faint'], '400', MONO, 3),
        ('ES|QL over the run', 9.8, p['faint'], '400', MONO, 0),
    ], accent=p['judge'], bg=p['judge_bg'], pad=12)

    jx = CX + 292
    jw = 396
    card(s, jx, vy, (jw - 12) / 2, 50, [
        ('Judge A', 12, p['text'], '600', SANS, 3),
        ('factual review', 10, p['muted'], '400', SANS, 0),
    ], accent=p['judge'], pad=10)
    card(s, jx + (jw - 12) / 2 + 12, vy, (jw - 12) / 2, 50, [
        ('Judge B', 12, p['text'], '600', SANS, 3),
        ('adversarial review', 10, p['muted'], '400', SANS, 0),
    ], accent=p['judge'], pad=10)
    s.arrow(jx + jw / 2, vy + 50, jx + jw / 2, vy + 64, stroke=p['judge'])
    card(s, jx, vy + 64, jw, 42, [
        ('Resolver', 11.5, p['text'], '600', SANS, 3),
        ('consensus, or a structured tiebreak when they disagree', 10, p['muted'], '400', SANS, 0),
    ], accent=p['judge'], pad=9)

    gx = CX + 706
    card(s, gx, vy, CW - 706 - 18, 106, [
        ('GPTZero', 12.5, p['text'], '600', SANS, 6),
        ('Bibliography scan on the', 10.5, p['muted'], '400', SANS, 2),
        ('written answer.', 10.5, p['muted'], '400', SANS, 6),
        ('citation_exists.status', 9.8, p['faint'], '400', MONO, 3),
        ('claim_reference.has_reference', 9.8, p['faint'], '400', MONO, 0),
    ], accent=p['judge'], bg=p['judge_bg'], pad=12)

    gy = vy + 124
    s.rect(CX + 18, gy, CW - 36, 44, p['card'], p['card_line'], r=8)
    s.rect(CX + 18, gy, 3.2, 44, p['check'], r=1.6)
    s.text(CX + 36, gy + 20, 'Payment gate', size=12.5, weight='600')
    s.text(CX + 132, gy + 20, 'every hard check must pass — at least one verifiable citation, no fabricated source, no unsupported claim', size=11, fill=p['muted'])
    s.text(CX + 36, gy + 36, 'Credit is pro-rata across the sub-claims, so a partly-correct answer is partly paid.', size=10.5, fill=p['faint'])
    b5 = y5 + zh5

    # ---------- 6. outcomes ----------
    oy = b5 + 46
    ow = 396
    lx_ = MID - 20 - ow
    rx_ = MID + 20
    s.line(MID, b5, MID, b5 + 22)
    s.path(f'M {MID} {b5+22} L {lx_+ow/2} {b5+22} L {lx_+ow/2} {oy}', stroke=p['ok'], marker='aok')
    s.path(f'M {MID} {b5+22} L {rx_+ow/2} {b5+22} L {rx_+ow/2} {oy}', stroke=p['bad'], marker='abad')
    s.text(lx_ + ow / 2 - 12, b5 + 38, 'pass', size=10, fill=p['ok'], weight='600', anchor='end', font=MONO)
    s.text(rx_ + ow / 2 + 12, b5 + 38, 'fail', size=10, fill=p['bad'], weight='600', font=MONO)

    s.rect(lx_, oy, ow, 62, p['ok_bg'], p['ok'], r=8)
    s.text(lx_ + 18, oy + 26, 'Release', size=13, weight='700', fill=p['ok'])
    s.text(lx_ + 18, oy + 46, 'Lamports transfer to that seller slot', size=11, fill=p['muted'])
    s.rect(rx_, oy, ow, 62, p['bad_bg'], p['bad'], r=8)
    s.text(rx_ + 18, oy + 26, 'Return', size=13, weight='700', fill=p['bad'])
    s.text(rx_ + 18, oy + 46, 'Nothing moves; the buyer keeps the amount', size=11, fill=p['muted'])

    # ---------- 7. chain ----------
    cy2 = oy + 62 + 34
    s.path(f'M {lx_+ow/2} {oy+62} L {lx_+ow/2} {oy+80} L {MID} {oy+80} L {MID} {cy2}', stroke=p['chain'], marker='aok')
    s.path(f'M {rx_+ow/2} {oy+62} L {rx_+ow/2} {oy+80} L {MID} {oy+80}', stroke=p['bad'])
    s.rect(CX, cy2, CW, 62, p['card'], p['chain'], r=10)
    s.rect(CX, cy2, 3.2, 62, p['chain'], r=1.6)
    s.text(CX + 20, cy2 + 26, 'Solana devnet', size=13, weight='700')
    s.text(CX + 20, cy2 + 46, 'One transaction per seller slot. The memo carries the hash of the verification that authorised it.', size=11, fill=p['muted'])
    s.text(CR - 20, cy2 + 26, 'escrow program written, not deployed', size=10, fill=p['faint'], anchor='end', font=MONO)
    s.text(CR - 20, cy2 + 46, 'the chain records the decision, it does not enforce it', size=10, fill=p['faint'], anchor='end', font=MONO)

    # ---------- sentry rail ----------
    rx0 = CR + 16
    rw = 130
    ry0 = y1
    rh = cy2 + 62 - y1
    s.rect(rx0, ry0, rw, rh, p['zone'], p['sentry'], r=12, dash='5 5', op='0.85')
    cx0 = rx0 + rw / 2
    cy0 = ry0 + rh / 2
    s.add(f'<g transform="translate({cx0},{cy0}) rotate(-90)">')
    s.text(0, -22, 'SENTRY', size=13, weight='700', fill=p['sentry'], anchor='middle', ls='3')
    s.text(0, 0, 'One distributed trace per task · spans stitched across alarm restarts', size=10.5, fill=p['muted'], anchor='middle')
    s.text(0, 18, 'Errors, releases from CF_VERSION_METADATA, Worker + browser source maps', size=10.5, fill=p['muted'], anchor='middle')
    s.add('</g>')
    for yy in [y1 + 39, y2 + 134, y3 + 88, y4 + 107, y5 + 112, oy + 31, cy2 + 31]:
        s.line(CR, yy, rx0, yy, stroke=p['sentry'], sw=1, dash='3 4')

    s.add('</svg>')
    return '\n'.join(s.o)

for pal in (LIGHT, DARK):
    out = sys.argv[1] + '/architecture-' + pal['name'] + '.svg'
    io.open(out, 'w', encoding='utf-8').write(build(pal))
    print('wrote', out)
