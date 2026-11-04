"""Native factories are imported only after an explicit module activation."""
import os
from borges.hoard_link.guard import check_request
from borges.hoard_link.copilot import install_copilot
from .specs import SPECS
from .external import EXTERNAL


def factory(key, data_dir, *, port, automatic=False, native_call=None, native_available=None):
    if key == 'publishing':
        import sys
        from pathlib import Path
        owner = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(owner / 'borges'))
        editorial = owner / 'editorial'
        if str(editorial) not in sys.path:
            sys.path.insert(0, str(editorial))
        os.environ['GUTENBERG_DATA_DIR'] = str(data_dir)
        os.environ['GUTENBERG_PORT'] = str(port)
        from gutenberg_hoard.app import app
        return app
    if key == 'library':
        from borges.config import Config
        from borges.main import create_app
        from borges import links_source
        from borges.extract import pdf
        def links_call(tool, args):
            try:
                return native_call('links', tool, args)
            except Exception as exc:  # the reading module is OFF or Links Hoard is not running
                raise links_source.LinksError(f'Links Hoard ({tool}): {exc}') from exc
        links_source.native_caller = links_call
        from .native_docs import NativeDocs
        pdf.fam_docs = NativeDocs(native_call, native_available)
        config = Config.from_env()
        config.data_dir, config.port, config.data_dir_configured = data_dir, port, True
        config.watch = config.autostart = automatic
        config.defer_stale = not automatic
        return create_app(config)
    if key in EXTERNAL:
        # Links Hoard and Kafka's Hoard run as their own apps; Writer calls them by reference.
        from .external import create_app
        return create_app(key, data_dir)
    raise KeyError(f'Unknown publishing module: {key}')
