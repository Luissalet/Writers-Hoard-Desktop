"""Exact-terms leg of the Borges hybrid search: BM25 splits identifiers, the verbatim leg recovers them."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'publishing'))
os.environ['HOARD_EVENTS'] = '0'
os.environ['BORGES_EMBED'] = 'none'
from borges import exact_terms
from borges.config import Config
from borges.indexer import Progress
from borges.services import Services

DECOY = ' '.join(['The narrator voice must speak slowly; a voice that can speak is a calm voice, so speak with a voice.'] * 4)
FILES = {
    'api.md': '# API\n\nCall voice_speak to read a paragraph aloud with the selected output.\n',
    'decoy.md': '# Narration\n\n' + DECOY + '\n',
    'router.md': '# Router\n\nThe R2T2 controller handles pulse routing for the rack.\n',
    'decoy2.md': '# Robots\n\nA robot with two arms and two legs needs two controllers and a second routing table.\n',
    'camel.md': '# Types\n\nThe ChapterOutline type lists every heading of the manuscript.\n',
    'misc1.md': '# One\n\nRelease v1.0 notes: the editor opens faster on large manuscripts.\n',
    'misc2.md': '# Two\n\nRelease v1.0 notes: footnotes are numbered per chapter.\n',
    'misc3.md': '# Three\n\nRelease v1.0 notes: the export dialog remembers its folder.\n',
    'misc4.md': '# Four\n\nRelease v1.0 notes: search highlights the matched words.\n',
    'misc5.md': '# Five\n\nPlain notes about the weather in the mountains during autumn.\n',
    'misc6.md': '# Six\n\nA list of reading goals for the winter and a plan for the spring.\n',
    'misc7.md': '# Seven\n\nCharacters need distinct speech patterns and their own vocabulary.\n',
    'misc8.md': '# Eight\n\nThe quoted phrase "pulse width modulation" appears only in this file.\n',
}


@pytest.fixture()
def services(tmp_path):
    docs = tmp_path / 'docs'
    docs.mkdir()
    for name, text in FILES.items():
        (docs / name).write_text(text, encoding='utf-8')
    svc = Services(Config(data_dir=tmp_path / 'data', embed_backend='none', watch=False, autostart=False))
    collection, _ = svc.collections.add('docs', str(docs), [], None, False, False)
    svc.indexer.index_collection(collection, Progress(collection_id=collection.id))
    svc.collection_id = collection.id
    yield svc
    svc.db.close()


def paths(result):
    return [hit['rel_path'] for hit in result['hits']]


def test_extract_picks_rare_token_shapes():
    assert exact_terms.extract('where is voice_speak used') == ['voice_speak']
    assert exact_terms.extract('how does R2T2 route') == ['R2T2']
    assert exact_terms.extract('the ChapterOutline type') == ['ChapterOutline']
    assert exact_terms.extract('see config.load_all now') == ['config.load_all']
    assert exact_terms.extract('flag --dry-run and snake-case') == ['--dry-run', 'snake-case']
    assert exact_terms.extract('call `pulse width` and "two words"') == ['pulse width', 'two words']
    assert exact_terms.extract('where did I write about memory') == []
    assert exact_terms.extract('voice_speak, voice_speak.') == ['voice_speak']


def test_idf_drops_common_and_missing_terms():
    assert exact_terms.keep(corpus=20, df=0) is False
    assert exact_terms.keep(corpus=20, df=7) is False  # 35 %
    assert exact_terms.keep(corpus=20, df=6) is True  # 30 %
    assert exact_terms.keep(corpus=4, df=3) is True  # a tiny corpus is not judged by ratios
    ranking, matched = exact_terms.rank({'rare': {1}, 'common': {1, 2, 3, 4, 5, 6, 7, 8}}, corpus=12)
    assert ranking[0][0] == 1 and matched == {1: ['rare']}


def test_identifier_is_recovered_where_bm25_splits_it(services):
    plain = services.search.search('voice_speak', mode='bm25', exact=False)
    assert paths(plain)[0] == 'decoy.md'  # BM25 reads "voice" and "speak" and prefers the narration text
    assert all('matched_terms' not in hit for hit in plain['hits'])
    result = services.search.search('voice_speak', mode='hybrid')
    assert paths(result)[0] == 'api.md'
    assert result['hits'][0]['matched_terms'] == ['voice_speak']
    assert result['exact_terms'] == ['voice_speak']
    assert 'decoy.md' not in [h['rel_path'] for h in result['hits'] if h.get('matched_terms')]


def test_acronym_with_digits_and_camel_case(services):
    top = services.search.search('R2T2', mode='hybrid')['hits'][0]
    assert top['rel_path'] == 'router.md' and top['matched_terms'] == ['R2T2']
    assert '<mark>R2T2</mark>' in top['snippet']
    camel = services.search.search('what is ChapterOutline', mode='bm25')
    assert camel['hits'][0]['rel_path'] == 'camel.md' and camel['hits'][0]['matched_terms'] == ['ChapterOutline']


def test_term_in_too_many_chunks_is_dropped(services):
    result = services.search.search('v1.0 footnotes', mode='hybrid')
    assert 'v1.0' not in result['exact_terms']  # 4 of 13 chunks
    assert all('matched_terms' not in hit for hit in result['hits'])
    assert paths(result)[0] == 'misc2.md'


def test_quoted_text_and_collection_filter(services):
    result = services.search.search('"pulse width modulation"', mode='hybrid', collection_id=services.collection_id)
    assert paths(result)[0] == 'misc8.md' and result['hits'][0]['matched_terms'] == ['pulse width modulation']
    assert services.search.search('R2T2', mode='hybrid', collection_id=services.collection_id + 99)['hits'] == []


def test_no_rare_term_means_no_change(services):
    on = services.search.search('plan for the spring', mode='hybrid')
    off = services.search.search('plan for the spring', mode='hybrid', exact=False)
    assert on['exact_terms'] == [] and paths(on) == paths(off)


def test_agent_tool_and_rest_expose_exact(services):
    from borges.agent_tools import SearchArgs, run_search
    assert SearchArgs(q='voice_speak').exact is True
    out = run_search(services, SearchArgs(q='voice_speak'))
    assert out['hits'][0]['matched_terms'] == ['voice_speak'] and out['exact_terms'] == ['voice_speak']
    off = run_search(services, SearchArgs(q='voice_speak', exact=False))
    assert off['exact_terms'] == [] and 'matched_terms' not in off['hits'][0]
