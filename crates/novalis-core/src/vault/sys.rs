//! Thin `extern "C"` declarations for the macOS calls the `libc` crate does
//! not expose. Constants are verified against the macOS SDK headers
//! (`sys/resource.h`, `sys/stat.h`, `sys/stdio.h`, `sys/errno.h`).

#![allow(dead_code)]

use std::ffi::CString;
use std::io;
use std::path::Path;

/// `IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES` (sys/resource.h).
pub const IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES: libc::c_int = 3;
/// `IOPOL_SCOPE_THREAD` (sys/resource.h).
pub const IOPOL_SCOPE_THREAD: libc::c_int = 1;
/// `IOPOL_MATERIALIZE_DATALESS_FILES_DEFAULT` (sys/resource.h).
pub const IOPOL_MATERIALIZE_DATALESS_FILES_DEFAULT: libc::c_int = 0;
/// `IOPOL_MATERIALIZE_DATALESS_FILES_OFF` (sys/resource.h).
pub const IOPOL_MATERIALIZE_DATALESS_FILES_OFF: libc::c_int = 1;
/// `IOPOL_MATERIALIZE_DATALESS_FILES_ON` (sys/resource.h).
pub const IOPOL_MATERIALIZE_DATALESS_FILES_ON: libc::c_int = 2;
/// `SF_DATALESS` (sys/stat.h): the file is a dataless (cloud-only) object.
pub const SF_DATALESS: u32 = 0x4000_0000;

#[cfg(target_os = "macos")]
extern "C" {
    fn getiopolicy_np(iotype: libc::c_int, scope: libc::c_int) -> libc::c_int;
    fn setiopolicy_np(iotype: libc::c_int, scope: libc::c_int, policy: libc::c_int) -> libc::c_int;
}

/// Current per-thread materialization policy.
pub fn get_materialize_policy() -> io::Result<libc::c_int> {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: plain syscall wrapper with constant arguments.
        let v = unsafe {
            getiopolicy_np(
                IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES,
                IOPOL_SCOPE_THREAD,
            )
        };
        if v < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(v)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(IOPOL_MATERIALIZE_DATALESS_FILES_DEFAULT)
    }
}

/// Set the per-thread materialization policy.
pub fn set_materialize_policy(policy: libc::c_int) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: plain syscall wrapper with constant arguments.
        let rc = unsafe {
            setiopolicy_np(
                IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES,
                IOPOL_SCOPE_THREAD,
                policy,
            )
        };
        if rc != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = policy;
        Ok(())
    }
}

fn cstring(p: &Path) -> io::Result<CString> {
    use std::os::unix::ffi::OsStrExt;
    CString::new(p.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL"))
}

/// `renamex_np(from, to, RENAME_EXCL)`: rename that fails with `EEXIST`
/// instead of clobbering. `Err(ENOTSUP)`/`Err(EINVAL)` mean the volume does not
/// support it and the caller should fall back to [`link_unlink`].
pub fn rename_excl(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let f = cstring(from)?;
        let t = cstring(to)?;
        // SAFETY: both strings are valid NUL-terminated C strings.
        let rc = unsafe { libc::renamex_np(f.as_ptr(), t.as_ptr(), libc::RENAME_EXCL) };
        if rc != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (from, to);
        Err(io::Error::from_raw_os_error(libc::ENOTSUP))
    }
}

/// Fallback for volumes without `RENAME_EXCL`: `link(from, to)` (fails with
/// `EEXIST` when `to` exists) followed by `unlink(from)`. Files only.
pub fn link_unlink(from: &Path, to: &Path) -> io::Result<()> {
    std::fs::hard_link(from, to)?;
    std::fs::remove_file(from)
}

/// Whether the extended attribute `name` is present on `path` (not following
/// symlinks).
pub fn has_xattr(path: &Path, name: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        let Ok(p) = cstring(path) else { return false };
        let Ok(n) = CString::new(name) else {
            return false;
        };
        // SAFETY: valid C strings; a NULL buffer with size 0 queries the size.
        let size = unsafe {
            libc::getxattr(
                p.as_ptr(),
                n.as_ptr(),
                std::ptr::null_mut(),
                0,
                0,
                libc::XATTR_NOFOLLOW,
            )
        };
        size >= 0
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, name);
        false
    }
}
