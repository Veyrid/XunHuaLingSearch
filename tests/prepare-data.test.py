import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).resolve().parents[1] / 'scripts/prepare-data.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PreparationTests(unittest.TestCase):
    def test_failed_rerun_invalidates_old_preparation_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / '.cache'
            cache.mkdir()
            (root / 'sources').mkdir()
            (root / 'data-sources.lock.json').write_text(json.dumps({'sources': [{'archiveFile': 'missing.tar.gz'}]}), encoding='utf-8')
            (root / 'sources/reading-corrections.json').write_text('[]', encoding='utf-8')
            (cache / 'prepared-data.json').write_text('{}', encoding='utf-8')
            with patch.object(prepare, 'ROOT', root), patch.object(prepare, 'CACHE', cache), patch.object(prepare.sys, 'argv', ['prepare-data.py']):
                with self.assertRaises(SystemExit):
                    prepare.main()
            self.assertFalse((cache / 'prepared-data.json').exists())

    def test_generic_title_is_not_necessarily_a_tune(self):
        tunes = {'九日', '如梦令', '浣溪沙'}
        self.assertEqual(prepare.infer_genre('九日', '白日依山尽，黄河入海流。欲穷千里目，更上一层楼。', tunes), '诗')
        self.assertEqual(prepare.infer_genre('如梦令 秋夜', '谁见？谁见？珊枕泪痕红泫。', tunes), '词')
        self.assertEqual(prepare.infer_genre('题如梦令', '谁见？谁见？', tunes), '诗')
        self.assertEqual(prepare.infer_genre('浣溪沙', '一曲新词酒一杯。去年天气旧亭台。夕阳西下几时回。', tunes), '词')

    def test_full_stop_rows_preserve_missing_glyph_and_question(self):
        self.assertEqual(prepare.csv_paragraphs('蕙帐?空怨，萝窗月自悬。知否那人心？旧恨新欢相半。'),
                         ['蕙帐?空怨，萝窗月自悬。', '知否那人心？旧恨新欢相半。'])

    def test_only_known_original_data_members_are_extracted(self):
        self.assertTrue(prepare.original_member('全唐诗/poet.tang.9000.json'))
        self.assertFalse(prepare.original_member('loader/spider.py'))
        self.assertFalse(prepare.original_member('../LICENSE'))

    def test_combined_collection_removed_only_with_complete_individual_coverage(self):
        rows=[{'题目':'古诗二首 其一','作者':'甲','内容':'春来。'},
              {'题目':'古诗二首 其二','作者':'甲','内容':'秋去。'},
              {'题目':'古诗二首','作者':'甲','内容':'春来。秋去。'},
              {'题目':'古诗二首','作者':'乙','内容':'春来。秋去。'},
              {'题目':'古诗二首','作者':'甲','内容':'春来。秋去。冬至。'}]
        self.assertEqual(prepare.covered_aggregates(rows),{2})

    def test_reviewed_reading_is_guarded_by_exact_body(self):
        content='上邪。我欲与君相知。长命无绝衰。山无陵。江水为竭。冬雷震震夏雨雪。天地合。乃敢与君绝。'
        items=json.loads((Path(__file__).resolve().parents[1]/'sources/reading-corrections.json').read_text(encoding='utf-8'))
        fixes={(c['author'],c['title'],c['contentSha256']):c for c in items}
        row={'作者':'两汉乐府','题目':'上邪','内容':content}
        result=prepare.apply_correction(row,fixes)
        self.assertIn('冬雷震震，夏雨雪。',result['paragraphs'])
        self.assertIsNone(prepare.apply_correction({**row,'内容':content+'异文。'},fixes))


if __name__ == '__main__':
    unittest.main()
