use std::{
    collections::HashMap,
    fs,
    io::Write as _,
    path::{Path, PathBuf},
    time::SystemTime,
};

use sha2::{Digest, Sha256};

#[derive(Default)]
pub(crate) struct SavedOutputs {
    receipts: HashMap<String, SavedFile>,
}

struct SavedFile {
    path: PathBuf,
    size: u64,
    modified: Option<SystemTime>,
    digest: [u8; 32],
}

impl SavedOutputs {
    pub(crate) fn create(&mut self, path: &Path, bytes: &[u8]) -> Result<String, String> {
        let mut nonce = [0u8; 24];
        getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
        let token = nonce.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let saved = Self::publish(path, bytes).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "Use a new output path. / Usa una ruta de salida nueva.".to_string()
            } else {
                format!("Could not save the new file. / No se pudo guardar el fichero nuevo. ({error})")
            }
        })?;
        self.receipts.insert(token.clone(), saved);
        Ok(token)
    }

    fn publish(path: &Path, bytes: &[u8]) -> std::io::Result<SavedFile> {
        let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
        let parent = parent.canonicalize()?;
        let name = path.file_name().ok_or_else(|| std::io::Error::other("expected an output filename"))?;
        let path = parent.join(name);
        let mut staged = tempfile::NamedTempFile::new_in(parent)?;
        staged.write_all(bytes)?;
        staged.as_file().sync_all()?;
        let digest = Sha256::digest(bytes).into();
        drop(staged.persist_noclobber(&path).map_err(|error| error.error)?);
        // Windows may update the timestamp when the writing handle closes.
        let modified = fs::symlink_metadata(&path).and_then(|metadata| metadata.modified()).ok();
        Ok(SavedFile { path, size: bytes.len() as u64, modified, digest })
    }

    pub(crate) fn undo(&mut self, token: &str) -> Result<(), String> {
        let saved = self
            .receipts
            .get(token)
            .ok_or("The save receipt is unknown or already used. / El recibo de guardado es desconocido o ya se ha utilizado.")?;
        let matches = fs::symlink_metadata(&saved.path).is_ok_and(|metadata| {
            metadata.is_file()
                && metadata.len() == saved.size
                && saved.modified.is_none_or(|modified| metadata.modified().ok() == Some(modified))
                && fs::read(&saved.path).is_ok_and(|bytes| Sha256::digest(&bytes)[..] == saved.digest)
        });
        if !matches {
            return Err("The saved file has changed or is missing. / El fichero guardado ha cambiado o ya no está.".into());
        }
        fs::remove_file(&saved.path)
            .map_err(|error| format!("Could not remove the saved file. / No se pudo eliminar el fichero guardado. ({error})"))?;
        self.receipts.remove(token);
        Ok(())
    }
}
