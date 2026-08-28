window.LupoCommon = (() => {
  const TRANSLATIONS = [
    ['LANÇAMENTO', 'Novedad'], ['Lançamento', 'Novedad'], ['Lançamentos', 'Novedades'],
    ['Lupo Cuecas', 'Lupo Ropa Interior Masculina'], ['Lupo Meias', 'Lupo Medias'], ['Meia-Calça', 'Pantimedias'], ['Meia-calça', 'Pantimedia'],
    ['FEMININOS', 'FEMENINOS'], ['FEMININO', 'FEMENINO'], ['FEMININA', 'FEMENINA'], ['MASCULINOS', 'MASCULINOS'], ['MASCULINO', 'MASCULINO'],
    ['LINGERIE', 'LENCERÍA'], ['CONFORTO', 'CONFORT'], ['SEM COSTURA', 'SIN COSTURAS'], ['COM COSTURA', 'CON COSTURA'],
    ['TOPS FEMININOS', 'TOPS FEMENINOS'], ['BOT TOMS FEMININO', 'PRENDAS INFERIORES FEMENINAS'], ['BOTTOMS FEMININO', 'PRENDAS INFERIORES FEMENINAS'],
    ['BOXERS SEAMLESS', 'BÓXERS SIN COSTURAS'], ['BOXES SEAMLESS', 'BÓXERS SIN COSTURAS'], ['CUECAS', 'ROPA INTERIOR MASCULINA'], ['CUECA', 'BÓXER'],
    ['MEIAS', 'MEDIAS'], ['MEIA', 'MEDIA'], ['CALÇAS', 'PANTALONES'], ['CALÇA', 'PANTALÓN'], ['CALCA', 'PANTALÓN'], ['SEGUNDA PELE', 'SEGUNDA PIEL'],
    ['LINHA', 'LÍNEA'], ['ATRIBUTOS', 'ATRIBUTOS'], ['TERAPÉUTICA', 'TERAPÉUTICA'], ['ESPORTIVAS', 'DEPORTIVAS'], ['ESPORTIVA', 'DEPORTIVA'],
    ['Algodão', 'Algodón'], ['Preta', 'Negro'], ['Branca', 'Blanco'], ['Cinza', 'Gris'], ['Marinho', 'Azul marino'], ['Vermelho', 'Rojo'], ['Verde Limão', 'Verde limón'],
    ['Tamanhos', 'Tallas'], ['Tamanho', 'Talla'], ['Talles', 'Tallas'], ['Tecnologia', 'Tecnología'], ['Descrição', 'Descripción'],
    ['sem costura', 'sin costuras'], ['com costura', 'con costura'], ['confeccionado', 'confeccionado'], ['confeccionada', 'confeccionada'],
    ['respirabilidade', 'respirabilidad'], ['secagem rápida', 'secado rápido'], ['suor', 'sudor'], ['bactérias', 'bacterias'], ['odores', 'olores'],
    ['frescor', 'frescura'], ['conforto', 'comodidad'], ['durante o uso', 'durante el uso'], ['durante a prática', 'durante la práctica'],
    ['alças', 'breteles'], ['alça', 'bretel'], ['costas', 'espalda'], ['corpo', 'cuerpo'], ['bojo removível', 'copa removible'], ['bojo', 'copa'],
    ['cós', 'cintura'], ['bolso', 'bolsillo'], ['bolsos', 'bolsillos'], ['frontal', 'delantero'], ['traseiro', 'trasero'], ['lateral', 'lateral'],
    ['alto suporte', 'soporte alto'], ['suporte alto', 'soporte alto'], ['suporte médio', 'soporte medio'], ['suporte leve', 'soporte leve'], ['sustenta??o', 'sujeción'],
    ['modelagem', 'modelado'], ['ajuste confortável', 'ajuste cómodo'], ['liberdade de movimento', 'libertad de movimiento'],
    ['ideal para', 'ideal para'], ['atividades', 'actividades'], ['baixo impacto', 'bajo impacto'], ['médio impacto', 'impacto medio'], ['alto impacto', 'alto impacto'],
    ['dia a dia', 'uso diario'], ['toque macio', 'tacto suave'], ['macia', 'suave'], ['opaca', 'opaca'], ['superopaca', 'superopaca'],
    ['Sem demarca??o de ponteira', 'Sin demarcación en la puntera'], ['Com demarca??o de ponteira', 'Con demarcación en la puntera'], ['ponteira', 'puntera'],
    ['Importada', 'Importada'], ['Adulto', 'Adulto'], ['Infantil', 'Infantil']
  ].sort((a, b) => b[0].length - a[0].length);

  function escapeHtml(s) {
    return (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function translateText(value) {
    let text = (value || '').toString();
    for (const [from, to] of TRANSLATIONS) {
      text = text.replace(new RegExp(escapeRegExp(from), 'gi'), to);
    }
    return text;
  }
  function normalizeText(v) {
    return (v || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function formatArs(value) {
    if (!Number.isFinite(value)) return 'Consultar';
    return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
  }
  function formatFob(value) {
    return Number.isFinite(value) ? `USD ${value.toFixed(2)}` : '—';
  }
  function parseArs(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    let s = String(raw).trim().replace(/\$/g, '').replace(/\s/g, '');
    if (!s) return null;
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }
  async function api(path, options = {}) {
    const opts = { credentials: 'include', ...options };
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 401 && !path.includes('/api/login')) {
      window.location.href = '/login';
      throw new Error('No autenticado');
    }
    if (!res.ok) throw new Error(data?.error || 'Error de servidor');
    return data;
  }
  const CATALOG_LABELS = {
    'Boxers y Slips 2026': 'Boxers y slips',
    'Lencería 2026': 'Lencería',
    'Medias 2026': 'Medias',
    'Lupo Cuecas PV 2026': 'Cuecas (Brasil)',
    'Lupo Lingerie PV 2026': 'Lingerie (Brasil)',
    'Lupo Meia-Calça PV 2026': 'Meia-calça (Brasil)',
    'Lupo Meias Esportivas PV 2026': 'Medias deportivas (Brasil)',
    'Lupo Meias Femininas PV 2026': 'Medias femeninas (Brasil)',
    'Lupo Meias Masculinas PV 2026': 'Medias masculinas (Brasil)',
    'Lupo Conjuntos PV 27': 'Conjuntos (Brasil)',
    'Lupo Sport Varejo PV 27': 'Sport (Brasil)',
    'Lupo Beachwear PV 2026': 'Beachwear (Brasil)',
    'Lupo Meias Baby PV 2026': 'Medias baby (Brasil)',
    'Lupo Meias Kids PV 2026': 'Medias kids (Brasil)',
    'Lupo Kids Seamless PV 2026': 'Kids seamless (Brasil)',
    'Lupo Pijamas PV 2026': 'Pijamas (Brasil)'
  };
  const PRODUCT_BADGES = {
    promo: { id: 'promo', label: 'Promoción', color: '#6b99de', promoTab: true },
    last: { id: 'last', label: 'Últimas unidades', color: '#111111', promoTab: false },
    sale: { id: 'sale', label: 'Liquidación', color: '#c45c00', promoTab: true }
  };
  let customLabels = { ...PRODUCT_BADGES };

  function setCustomLabels(labels) {
    customLabels = {};
    for (const raw of labels || []) {
      const id = String(raw?.id || '').trim();
      if (!id) continue;
      customLabels[id] = {
        id,
        label: String(raw?.name || raw?.label || id).trim(),
        color: String(raw?.color || '#111111'),
        promoTab: Boolean(raw?.promoTab)
      };
    }
  }

  function getCustomLabels() {
    return Object.values(customLabels);
  }

  function badgeInfo(id) {
    return customLabels[id] || null;
  }

  function badgeLabel(id, custom) {
    const text = String(custom || '').trim();
    if (text) return text;
    return badgeInfo(id)?.label || '';
  }

  function badgeStyle(id) {
    const color = badgeInfo(id)?.color;
    return color ? `background:${color}` : '';
  }

  function isPromoLabel(id) {
    return Boolean(badgeInfo(id)?.promoTab);
  }
  function catalogLabel(name) {
    return CATALOG_LABELS[name] || translateText(name);
  }
  async function logout() {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
  }
  return { escapeHtml, translateText, normalizeText, formatArs, formatFob, parseArs, api, logout, catalogLabel, PRODUCT_BADGES, setCustomLabels, getCustomLabels, badgeInfo, badgeLabel, badgeStyle, isPromoLabel };
})();
