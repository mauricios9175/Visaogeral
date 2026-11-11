"""Gera os modelos de relatório (PowerPoint) dos clientes próprios e da Viccon.

O painel sobe estes arquivos para o Google Drive (convertidos em Google Slides) e troca os marcadores {{...}}
pelos números, tabelas e gráficos. Depois de subir, o modelo pode ser editado à vontade no Drive (cores, fontes,
imagens): só não apague os textos entre {{ }}.

Uso: python3 scripts/gerar-modelos-relatorio.py   (precisa do pacote python-pptx)
"""
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Emu, Pt

LARGURA, ALTURA = 9144000, 5143500
PASTA = Path(__file__).resolve().parent.parent / "modelos"

TEMAS = {
    "proprio": {
        "arquivo": "relatorio-proprio.pptx", "titulo_capa": "RELATÓRIO MENSAL",
        "primaria": "1E3A8A", "destaque": "F59E0B", "clara": "EEF2FF", "texto": "1F2937", "fonte": "Poppins",
    },
    "viccon": {
        "arquivo": "relatorio-viccon.pptx", "titulo_capa": "RELATÓRIO DE RESULTADOS",
        "primaria": "0F172A", "destaque": "14B8A6", "clara": "F0FDFA", "texto": "1F2937", "fonte": "Inter",
    },
}


def rgb(h: str) -> RGBColor:
    return RGBColor.from_string(h)


def caixa_texto(slide, x, y, w, h, texto, tema, tamanho=14, cor=None, negrito=False, alinhar=PP_ALIGN.LEFT, nome=None, meio=False):
    tb = slide.shapes.add_textbox(Emu(x), Emu(y), Emu(w), Emu(h))
    if nome:
        tb.name = nome
    tf = tb.text_frame
    tf.word_wrap = True
    if meio:
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    for i, linha in enumerate(texto.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = alinhar
        r = p.add_run()
        r.text = linha
        r.font.size = Pt(tamanho)
        r.font.bold = negrito
        r.font.name = tema["fonte"]
        r.font.color.rgb = rgb(cor or tema["texto"])
    return tb


def retangulo(slide, x, y, w, h, cor):
    s = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Emu(x), Emu(y), Emu(w), Emu(h))
    s.fill.solid()
    s.fill.fore_color.rgb = rgb(cor)
    s.line.fill.background()
    s.shadow.inherit = False
    return s


def fundo(slide, cor):
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = rgb(cor)


def slide_titulo(prs, tema, titulo, subtitulo=None):
    """Slide branco com faixa colorida à esquerda e título no alto."""
    s = prs.slides.add_slide(prs.slide_layouts[6])
    fundo(s, "FFFFFF")
    retangulo(s, 0, 0, 120000, ALTURA, tema["primaria"])
    retangulo(s, 120000, 0, 40000, ALTURA, tema["destaque"])
    caixa_texto(s, 420000, 180000, 7800000, 480000, titulo, tema, tamanho=22, cor=tema["primaria"], negrito=True)
    if subtitulo:
        caixa_texto(s, 420000, 610000, 7800000, 300000, subtitulo, tema, tamanho=11, cor="6B7280")
    # rodapé: cliente e período (trocados pelo painel)
    caixa_texto(s, 420000, ALTURA - 330000, 6000000, 260000, "{{cliente}} · {{periodo}}", tema, tamanho=9, cor="9CA3AF")
    return s


def marcador(slide, marca, tema, x=420000, y=1000000, w=LARGURA - 420000 - 250000, h=ALTURA - 1000000 - 420000):
    """Caixa do marcador: o painel apaga e desenha a tabela/gráfico no mesmo lugar e tamanho."""
    caixa_texto(slide, x, y, w, h, marca, tema, tamanho=12, cor="9CA3AF", nome=marca)


def capa(prs, tema):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    fundo(s, tema["primaria"])
    retangulo(s, 0, ALTURA - 140000, LARGURA, 140000, tema["destaque"])
    caixa_texto(s, 700000, 1500000, 7700000, 400000, tema["titulo_capa"], tema, tamanho=14, cor=tema["destaque"], negrito=True)
    caixa_texto(s, 700000, 1900000, 7700000, 900000, "{{cliente}}", tema, tamanho=36, cor="FFFFFF", negrito=True)
    caixa_texto(s, 700000, 2850000, 7700000, 450000, "{{periodo}}", tema, tamanho=18, cor="E5E7EB")


def destaques(prs, tema):
    s = slide_titulo(prs, tema, "Destaques do período", "O que aconteceu e o que os números mostram")
    retangulo(s, 420000, 1000000, LARGURA - 420000 - 250000, ALTURA - 1000000 - 420000, tema["clara"])
    caixa_texto(s, 600000, 1120000, LARGURA - 600000 - 450000, ALTURA - 1120000 - 560000, "{{analise}}", tema, tamanho=13)


def funil(prs, tema):
    # o painel apaga o que não é título/imagem e desenha o funil do cliente; o título precisa ter {{periodo}}
    s = prs.slides.add_slide(prs.slide_layouts[6])
    fundo(s, "FFFFFF")
    retangulo(s, 0, 0, 120000, ALTURA, tema["primaria"])
    caixa_texto(s, 420000, 250000, 8300000, 470000, "Funil de vendas · {{periodo}}", tema, tamanho=20, cor=tema["primaria"], negrito=True)
    caixa_texto(s, 3400000, 1000000, 1200000, 500000, "{{leads}}", tema, tamanho=12)


def acoes(prs, tema):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    fundo(s, "FFFFFF")
    retangulo(s, 0, 0, 3600000, ALTURA, tema["primaria"])
    caixa_texto(s, 400000, 1700000, 2900000, 1500000, "Ações realizadas\ne próximos passos", tema, tamanho=24, cor="FFFFFF", negrito=True)
    retangulo(s, 400000, 3300000, 600000, 50000, tema["destaque"])
    caixa_texto(s, 3900000, 350000, 4950000, ALTURA - 700000, "{{acoes}}", tema, tamanho=11)


def encerramento(prs, tema):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    fundo(s, tema["primaria"])
    caixa_texto(s, 700000, 2000000, 7700000, 700000, "Obrigado!", tema, tamanho=34, cor="FFFFFF", negrito=True, alinhar=PP_ALIGN.CENTER)
    caixa_texto(s, 700000, 2750000, 7700000, 400000, "Qualquer dúvida, é só chamar.", tema, tamanho=14, cor="E5E7EB", alinhar=PP_ALIGN.CENTER)


def gerar(chave: str):
    tema = TEMAS[chave]
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(LARGURA), Emu(ALTURA)
    capa(prs, tema)
    marcador(slide_titulo(prs, tema, "Resumo do período", "Principais indicadores, comparados com o período anterior"), "{{tabela:resumo}}", tema)
    destaques(prs, tema)
    if chave == "proprio":
        funil(prs, tema)
    marcador(slide_titulo(prs, tema, "Investimento por mês"), "{{grafico:investimento}}", tema)
    marcador(slide_titulo(prs, tema, "Resultados por mês"), "{{grafico:resultados}}", tema)
    marcador(slide_titulo(prs, tema, "Custo por resultado por mês"), "{{grafico:custo}}", tema)
    if chave == "proprio":
        marcador(slide_titulo(prs, tema, "Vendas realizadas", "Do CRM"), "{{grafico:vendas}}", tema)
    else:
        marcador(slide_titulo(prs, tema, "Públicos"), "{{tabela:conjuntos}}", tema)
    marcador(slide_titulo(prs, tema, "Anúncios do período", "Os que mais trouxeram resultado"), "{{tabela:anuncios}}", tema)
    marcador(slide_titulo(prs, tema, "Campanhas no Google"), "{{tabela:google}}", tema)
    acoes(prs, tema)
    encerramento(prs, tema)
    destino = PASTA / tema["arquivo"]
    prs.save(destino)
    print("gerado:", destino)


if __name__ == "__main__":
    for k in TEMAS:
        gerar(k)
