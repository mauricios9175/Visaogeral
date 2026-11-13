import "server-only";
import { consultar } from "./google";
import { acessoGoogle } from "./acesso-google";
import { CONFIG_GOOGLE_PADRAO, normalizarGoogle, type ConfigGoogle, type Correspondencia, type GrupoGoogle, type LocalGoogle } from "./modelos-google";

// "Copiar e colar" de campanha do Google Ads (como no Google Ads Editor): lê a campanha inteira numa conta e monta a
// configuração da montagem do painel, para colar em outra conta (ou na mesma) depois de revisar. Nada é criado aqui.

export type CopiaGoogle = { config: ConfigGoogle; origem: string; avisos: string[] };

const MATCH: Record<string, Correspondencia> = { BROAD: "AMPLA", PHRASE: "FRASE", EXACT: "EXATA" };
const reais = (micros: unknown) => Math.round(Number(micros ?? 0) / 10_000) / 100;
const id = (rn: string | undefined) => rn?.split("/").pop() ?? "";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function lerCampanhaParaCopiar(contaId: string, campanhaId: string): Promise<CopiaGoogle> {
  if (!/^\d+$/.test(campanhaId)) throw new Error("Campanha inválida.");
  const { acesso, conta } = await acessoGoogle(contaId);
  const login = conta?.login_customer_id ?? null;
  const q = (gaql: string) => consultar(acesso, contaId, login, gaql);
  const avisos: string[] = [];

  const [camp] = await q(`
    SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.bidding_strategy_type,
      campaign.maximize_conversions.target_cpa_micros, campaign.target_cpa.target_cpa_micros,
      campaign.network_settings.target_search_network, campaign.final_url_suffix, campaign_budget.amount_micros
    FROM campaign WHERE campaign.id = ${campanhaId}`);
  if (!camp) throw new Error("Campanha não encontrada nessa conta.");
  const tipoCanal = camp.campaign.advertisingChannelType;
  if (tipoCanal !== "SEARCH" && tipoCanal !== "PERFORMANCE_MAX") {
    throw new Error(`Por enquanto dá para copiar campanhas de Pesquisa e Performance Max (esta é ${String(tipoCanal).toLowerCase()}).`);
  }
  const pmax = tipoCanal === "PERFORMANCE_MAX";
  const cpa = reais(camp.campaign.maximizeConversions?.targetCpaMicros ?? camp.campaign.targetCpa?.targetCpaMicros);
  const estrategia = String(camp.campaign.biddingStrategyType ?? "");
  const lance: ConfigGoogle["lance"] = estrategia === "TARGET_SPEND" && !pmax ? "maximizar_cliques" : cpa > 0 ? "cpa_desejado" : "maximizar_conversoes";
  if (!["MAXIMIZE_CONVERSIONS", "TARGET_SPEND", "TARGET_CPA"].includes(estrategia)) avisos.push(`A estratégia de lance (${estrategia.toLowerCase()}) vira “${lance === "cpa_desejado" ? "Maximizar conversões com CPA" : "Maximizar conversões"}”.`);

  // locais (e negativas da campanha)
  const criterios = await q(`
    SELECT campaign_criterion.type, campaign_criterion.negative, campaign_criterion.location.geo_target_constant,
      campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion WHERE campaign.id = ${campanhaId} AND campaign_criterion.status != 'REMOVED'`);
  const geoIds = criterios.filter((c: any) => c.campaignCriterion.type === "LOCATION" && !c.campaignCriterion.negative).map((c: any) => id(c.campaignCriterion.location?.geoTargetConstant)).filter(Boolean);
  if (criterios.some((c: any) => c.campaignCriterion.type === "LOCATION" && c.campaignCriterion.negative)) avisos.push("Locais excluídos não vêm na cópia: exclua de novo no Google Ads depois de colar.");
  if (criterios.some((c: any) => c.campaignCriterion.type === "PROXIMITY")) avisos.push("Raio em volta de endereço não vem na cópia: escolha a cidade aqui ou ajuste no Google Ads.");
  let locais: LocalGoogle[] = [];
  if (geoIds.length) {
    const geo = await q(`SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.target_type
      FROM geo_target_constant WHERE geo_target_constant.id IN (${geoIds.join(",")})`);
    locais = geo.map((g: any) => ({ id: String(g.geoTargetConstant.id), nome: g.geoTargetConstant.canonicalName ?? g.geoTargetConstant.name, tipo: g.geoTargetConstant.targetType ?? "" }));
  }
  const negativas = criterios.filter((c: any) => c.campaignCriterion.type === "KEYWORD" && c.campaignCriterion.negative)
    .map((c: any) => ({ texto: c.campaignCriterion.keyword.text, correspondencia: MATCH[c.campaignCriterion.keyword.matchType] ?? "AMPLA" }));

  // extensões da campanha: sitelinks e frases de destaque
  const assets = await q(`
    SELECT campaign_asset.field_type, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2,
      asset.final_urls, asset.callout_asset.callout_text
    FROM campaign_asset WHERE campaign.id = ${campanhaId} AND campaign_asset.status != 'REMOVED'`);
  const sitelinks = assets.filter((a: any) => a.campaignAsset.fieldType === "SITELINK" && a.asset.sitelinkAsset).map((a: any) => ({
    texto: a.asset.sitelinkAsset.linkText ?? "", descricao1: a.asset.sitelinkAsset.description1 ?? "", descricao2: a.asset.sitelinkAsset.description2 ?? "", url: a.asset.finalUrls?.[0] ?? "",
  }));
  const frases = assets.filter((a: any) => a.campaignAsset.fieldType === "CALLOUT").map((a: any) => a.asset.calloutAsset?.calloutText).filter(Boolean);

  const base: ConfigGoogle = {
    ...CONFIG_GOOGLE_PADRAO, tipo: pmax ? "pmax" : "pesquisa",
    nomeCampanha: camp.campaign.name, orcamentoDiario: reais(camp.campaignBudget?.amountMicros) || CONFIG_GOOGLE_PADRAO.orcamentoDiario,
    lance, cpaDesejado: cpa, parceiros: !!camp.campaign.networkSettings?.targetSearchNetwork,
    locais, negativas, sitelinks, frases, parametrosUrl: camp.campaign.finalUrlSuffix ?? "",
  };

  if (pmax) {
    const recursos = await q(`
      SELECT asset_group.id, asset_group.name, asset_group.final_urls, asset_group_asset.field_type, asset.text_asset.text
      FROM asset_group_asset WHERE campaign.id = ${campanhaId} AND asset_group_asset.status != 'REMOVED' AND asset_group.status != 'REMOVED'`);
    const grupoId = recursos[0]?.assetGroup?.id;
    const doGrupo = recursos.filter((r: any) => r.assetGroup.id === grupoId);
    const textos = (campo: string) => doGrupo.filter((r: any) => r.assetGroupAsset.fieldType === campo).map((r: any) => r.asset.textAsset?.text).filter(Boolean) as string[];
    const temas = grupoId ? (await q(`SELECT asset_group_signal.search_theme.text FROM asset_group_signal WHERE asset_group.id = ${grupoId}`))
      .map((s: any) => s.assetGroupSignal?.searchTheme?.text).filter(Boolean) : [];
    if (new Set(recursos.map((r: any) => r.assetGroup.id)).size > 1) avisos.push("A campanha tem mais de um grupo de recursos: veio só o primeiro.");
    avisos.push("Imagens e vídeos não passam de uma conta para outra: escolha as imagens e o logo de novo antes de publicar.");
    return {
      origem: camp.campaign.name, avisos,
      config: normalizarGoogle({
        ...base, url: doGrupo[0]?.assetGroup?.finalUrls?.[0] ?? "",
        pmax: { nomeEmpresa: textos("BUSINESS_NAME")[0] ?? "", titulos: textos("HEADLINE"), titulosLongos: textos("LONG_HEADLINE"), descricoes: textos("DESCRIPTION"), temas },
      }),
    };
  }

  // Pesquisa: grupos, palavras-chave e o anúncio responsivo de cada grupo
  const [grupos, palavras, anuncios] = await Promise.all([
    q(`SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.final_url_suffix FROM ad_group WHERE campaign.id = ${campanhaId} AND ad_group.status != 'REMOVED'`),
    q(`SELECT ad_group.id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.negative
      FROM ad_group_criterion WHERE campaign.id = ${campanhaId} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`),
    q(`SELECT ad_group.id, ad_group_ad.status, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2
      FROM ad_group_ad WHERE campaign.id = ${campanhaId} AND ad_group_ad.status != 'REMOVED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'`),
  ]);
  let maisDeUmAnuncio = false, negativasDeGrupo = false;
  const gruposCfg: GrupoGoogle[] = grupos.map((g: any) => {
    const gid = g.adGroup.id;
    const kws = palavras.filter((p: any) => p.adGroup.id === gid);
    if (kws.some((k: any) => k.adGroupCriterion.negative)) negativasDeGrupo = true;
    // o anúncio ativo do grupo (ou o primeiro)
    const ads = anuncios.filter((a: any) => a.adGroup.id === gid).sort((a: any, b: any) => Number(b.adGroupAd.status === "ENABLED") - Number(a.adGroupAd.status === "ENABLED"));
    if (ads.length > 1) maisDeUmAnuncio = true;
    const rsa = ads[0]?.adGroupAd?.ad;
    return {
      nome: g.adGroup.name,
      palavras: kws.filter((k: any) => !k.adGroupCriterion.negative).map((k: any) => ({ texto: k.adGroupCriterion.keyword.text, correspondencia: MATCH[k.adGroupCriterion.keyword.matchType] ?? "AMPLA" })),
      titulos: (rsa?.responsiveSearchAd?.headlines ?? []).map((h: any) => h.text).filter(Boolean),
      descricoes: (rsa?.responsiveSearchAd?.descriptions ?? []).map((d: any) => d.text).filter(Boolean),
      url: rsa?.finalUrls?.[0] ?? "", caminho1: rsa?.responsiveSearchAd?.path1 ?? "", caminho2: rsa?.responsiveSearchAd?.path2 ?? "",
    };
  });
  if (!gruposCfg.length) throw new Error("A campanha não tem grupos de anúncios para copiar.");
  if (maisDeUmAnuncio) avisos.push("Grupos com mais de um anúncio: veio o ativo (ou o primeiro) de cada grupo.");
  if (negativasDeGrupo) avisos.push("Palavras negativas de grupo não vêm na cópia (as da campanha vêm).");
  if (grupos.some((g: any) => g.adGroup.status === "PAUSED")) avisos.push("Grupos que estavam pausados vêm junto (tudo é criado pausado).");
  if (!base.parametrosUrl) base.parametrosUrl = grupos.find((g: any) => g.adGroup.finalUrlSuffix)?.adGroup.finalUrlSuffix ?? "";
  // link padrão da campanha: o mais usado nos anúncios
  const urls = gruposCfg.map((g) => g.url).filter(Boolean);
  const url = urls.sort((a, b) => urls.filter((x) => x === b).length - urls.filter((x) => x === a).length)[0] ?? "";
  return {
    origem: camp.campaign.name, avisos,
    config: normalizarGoogle({ ...base, url, grupos: gruposCfg.map((g) => ({ ...g, url: g.url === url ? "" : g.url })) }),
  };
}
