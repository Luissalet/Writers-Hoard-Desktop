"""Exact-terms leg of the hybrid search: rare tokens of a query searched verbatim in the chunk text.

BM25 over FTS5 splits identifiers at `_`, `.` and `-` (voice_speak -> voice, speak) and folds case, so a code name, a
ticket id or an acronym drowns among ordinary words. This module picks those tokens out of the query (pure functions,
no database) and the `Search` class looks them up with `instr` and ranks the chunks by IDF.
"""

from __future__ import annotations

import math
import re

MAX_TERMS = 8
MIN_TERM_CHARS = 2
MAX_DF_RATIO = 0.30  # a term found in more than this share of the searched chunks says nothing about a chunk
MIN_CORPUS = 10  # below this many chunks a ratio means nothing, so no term is dropped for being common

_QUOTED = re.compile(r"`([^`]{2,80})`|\"([^\"]{2,80})\"|«([^»]{2,80})»")
_EDGE = ".,;:!?()[]{}<>\"'`«»¿¡"
_CAMEL = re.compile(r"[a-z0-9][A-Z]|[A-Z]{2,}[a-z]")
_ACRONYM = re.compile(r"[A-Z][A-Z0-9]+")


def _is_identifier(token: str) -> bool:
    if any(ch.isdigit() for ch in token):
        return True
    inner = token.strip("_.-")
    if "_" in inner:
        return True
    if re.search(r"[A-Za-z0-9][.\-][A-Za-z0-9]", inner):
        return True
    if _ACRONYM.fullmatch(token):
        return True
    return bool(_CAMEL.search(token))


def extract(q: str) -> list[str]:
    """The tokens of `q` worth a verbatim search, in order of appearance, without repeats: quoted or backtick text
    as one phrase; identifiers with `_` `.` `-`; CamelCase; ALL-CAPS acronyms; tokens with digits."""
    out: list[str] = []

    def add(term: str) -> None:
        term = term.strip()
        if len(term) >= MIN_TERM_CHARS and term not in out and len(out) < MAX_TERMS:
            out.append(term)

    rest = q
    for match in _QUOTED.finditer(q):
        add(next(g for g in match.groups() if g))
    rest = _QUOTED.sub(" ", q)
    for raw in rest.split():
        token = raw.strip(_EDGE)
        if token and _is_identifier(token):
            add(token)
    return out


def idf(corpus: int, df: int) -> float:
    return math.log(1.0 + (corpus - df + 0.5) / (df + 0.5))


def keep(corpus: int, df: int) -> bool:
    """False for a term nobody has (nothing to find) or one so common it separates nothing."""
    if df <= 0:
        return False
    return not (corpus >= MIN_CORPUS and df / corpus > MAX_DF_RATIO)


def rank(postings: dict[str, set[int]], corpus: int) -> tuple[list[tuple[int, float]], dict[int, list[str]]]:
    """Chunks ranked by the summed IDF of the terms they contain, and the terms each one matched.
    `postings` maps a term to the ids of the chunks that contain it; `corpus` is how many chunks were searched."""
    scores: dict[int, float] = {}
    matched: dict[int, list[str]] = {}
    for term, ids in postings.items():
        if not keep(corpus, len(ids)):
            continue
        weight = idf(corpus, len(ids))
        for chunk_id in ids:
            scores[chunk_id] = scores.get(chunk_id, 0.0) + weight
            matched.setdefault(chunk_id, []).append(term)
    ranking = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    return ranking, matched
