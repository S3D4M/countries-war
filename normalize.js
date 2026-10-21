// يحوّل أحداث مكتبة تيك توك إلى صيغة بسيطة تفهمها صفحة اللعبة
export function normalize(name, d) {
  if (!d) return null;
  const u = d.user || {};
  const uniqueId = String(u.uniqueId || d.uniqueId || u.userId || d.userId || '');
  const nickname = String(u.nickname || d.nickname || uniqueId);
  if (!uniqueId && !nickname) return null;
  const base = { uniqueId: uniqueId || nickname, nickname };

  if (name === 'chat') {
    const comment = d.comment || d.text || '';
    if (!comment) return null;
    return { event: 'chat', data: { ...base, comment } };
  }

  if (name === 'gift') {
    const gd = d.giftDetails || d.gift || {};
    const type = gd.giftType ?? gd.gift_type ?? d.giftType;
    const end = d.repeatEnd ?? gd.repeat_end;
    if (type === 1 && (end === false || end === 0)) return null;
    const diamondCount = Number(gd.diamondCount ?? gd.diamond_count ?? d.diamondCount ?? d.diamonds ?? 1) || 1;
    const repeatCount = Number(d.repeatCount ?? gd.repeat_count ?? 1) || 1;
    return { event: 'gift', data: { ...base, giftName: gd.giftName || gd.name || d.giftName || '', diamondCount, repeatCount } };
  }

  if (name === 'like') {
    return { event: 'like', data: { ...base, likeCount: Number(d.likeCount || d.count || 1) || 1 } };
  }

  if (name === 'member') return { event: 'member', data: base };
  return null;
}
