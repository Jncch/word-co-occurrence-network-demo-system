import re
from collections import Counter
from janome.tokenizer import Tokenizer

TARGET_POS = {"名詞"}
EXCLUDE_POS_DETAIL = {"数", "非自立", "代名詞", "接尾"}
STOPWORDS = {
    "こと", "もの", "ため", "よう", "それ", "これ", "あれ",
    "ここ", "そこ", "あそこ", "とき", "ところ", "やつ", "わけ",
    "感じ", "意味", "部分", "関係", "問題", "状況", "場合",
    "今", "中", "上", "下", "前", "後", "内", "外",
    "方", "人", "話", "点", "形", "系", "の", "ん",
}

_tokenizer = Tokenizer()


def split_sentences(text: str) -> list[str]:
    text = re.sub(r"^\s*[\[（(]?[\w\s　]+[\]）)]?\s*[:：]\s*", "", text, flags=re.MULTILINE)
    sentences = re.split(r"[。！？\n]+", text)
    return [s.strip() for s in sentences if len(s.strip()) > 3]


def extract_nouns(sentences: list[str]) -> list[list[str]]:
    result = []
    for sentence in sentences:
        nouns = []
        for token in _tokenizer.tokenize(sentence):
            pos = token.part_of_speech.split(",")
            main_pos = pos[0]
            sub_pos = pos[1] if len(pos) > 1 else ""
            surface = token.surface
            if main_pos not in TARGET_POS:
                continue
            if sub_pos in EXCLUDE_POS_DETAIL:
                continue
            if surface in STOPWORDS:
                continue
            if len(surface) < 2:
                continue
            nouns.append(surface)
        if len(nouns) >= 2:
            result.append(nouns)
    return result


def build_cooccurrence(noun_sentences: list[list[str]], window_size: int) -> tuple[Counter, Counter]:
    term_freq: Counter = Counter()
    cooc_counter: Counter = Counter()
    for nouns in noun_sentences:
        term_freq.update(nouns)
        unique_nouns = list(dict.fromkeys(nouns))
        for i, word_a in enumerate(unique_nouns):
            for word_b in unique_nouns[i + 1: i + 1 + window_size]:
                cooc_counter[tuple(sorted([word_a, word_b]))] += 1
    return term_freq, cooc_counter


def analyze(text: str, window_size: int = 10, min_freq: int = 2, min_cooc: int = 2) -> dict:
    sentences = split_sentences(text.strip())
    noun_sentences = extract_nouns(sentences)
    term_freq, cooc_counter = build_cooccurrence(noun_sentences, window_size)

    valid_words = {w for w, c in term_freq.items() if c >= min_freq}

    edges = []
    used_nodes: set[str] = set()
    for (word_a, word_b), count in cooc_counter.items():
        if count < min_cooc:
            continue
        if word_a not in valid_words or word_b not in valid_words:
            continue
        edges.append({"source": word_a, "target": word_b, "weight": count})
        used_nodes.add(word_a)
        used_nodes.add(word_b)

    nodes = [
        {"id": w, "label": w, "frequency": term_freq[w]}
        for w in used_nodes
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "sentence_count": len(sentences),
            "valid_sentence_count": len(noun_sentences),
            "unique_term_count": len(term_freq),
            "node_count": len(nodes),
            "edge_count": len(edges),
        },
    }
