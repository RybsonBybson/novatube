//! Platform helpers: keeping child processes tied to NovaTube's lifetime and
//! reporting free disk space.
//!
//! On Windows every spawned child (yt-dlp, ffmpeg) is assigned to a single Job
//! Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. The kernel then
//! tears the whole tree down when NovaTube exits — even on a crash or a forced
//! kill — so a reboot can never leave orphaned encoders eating the CPU or
//! hammering the SSD. No extra crates are pulled in: the handful of kernel32
//! entry points are declared directly.

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::sync::OnceLock;

    type Handle = *mut c_void;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
    const PROCESS_SET_QUOTA: u32 = 0x0100;
    const PROCESS_TERMINATE: u32 = 0x0001;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: u32, info: *mut c_void, len: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            free_bytes_available: *mut u64,
            total_bytes: *mut u64,
            total_free_bytes: *mut u64,
        ) -> i32;
    }

    /// The job handle is stored as a `usize` so the static stays `Send + Sync`.
    /// It is intentionally never closed: closing it (or exiting the process)
    /// is what makes Windows kill every assigned child.
    static JOB: OnceLock<usize> = OnceLock::new();

    pub fn init_child_job() {
        let job = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
        if job.is_null() {
            return;
        }

        let mut info = ExtendedLimitInformation::default();
        info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                &mut info as *mut _ as *mut c_void,
                std::mem::size_of::<ExtendedLimitInformation>() as u32,
            )
        };
        if configured == 0 {
            unsafe { CloseHandle(job) };
            return;
        }
        let _ = JOB.set(job as usize);
    }

    pub fn assign_child_to_job(pid: u32) {
        let Some(&job) = JOB.get() else {
            return;
        };
        if pid == 0 {
            return;
        }
        let job = job as Handle;
        // A process that already exited between spawn and assignment simply
        // fails to open; that is harmless.
        let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if process.is_null() {
            return;
        }
        unsafe {
            AssignProcessToJobObject(job, process);
            CloseHandle(process);
        }
    }

    pub fn free_space(path: &Path) -> Option<u64> {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut available: u64 = 0;
        let ok = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut())
        };
        if ok == 0 {
            None
        } else {
            Some(available)
        }
    }

    /// Half of the logical cores, capped at 8: keeps FFmpeg from saturating the
    /// CPU (and the NVMe with it) while still using modern hardware well.
    pub fn encode_threads() -> usize {
        let cores = std::thread::available_parallelism().map(|value| value.get()).unwrap_or(4);
        (cores / 2).clamp(1, 8)
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::Path;

    pub fn init_child_job() {}
    pub fn assign_child_to_job(_pid: u32) {}

    pub fn free_space(_path: &Path) -> Option<u64> {
        None
    }

    pub fn encode_threads() -> usize {
        let cores = std::thread::available_parallelism().map(|value| value.get()).unwrap_or(4);
        (cores / 2).clamp(1, 8)
    }
}

pub use imp::{assign_child_to_job, encode_threads, free_space, init_child_job};

/// Free-space floor kept in reserve so a running encode can always finalize and
/// the OS itself never runs out of room mid-write.
pub const MIN_FREE_BYTES: u64 = 1024 * 1024 * 1024;
