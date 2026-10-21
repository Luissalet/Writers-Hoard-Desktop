const {app}=require('electron');require('../scripts/run-codex-properties-ui.cjs').main().catch(error=>{console.error(error.stack||error);app.exit(1);});
