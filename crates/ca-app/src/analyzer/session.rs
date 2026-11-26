use super::{Analysis, analyze_with_progress};
use crate::job_progress::{Progress, Snapshot, Stage};
use crate::shell::Language;
use ca_analysis::{Format, MAX_BYTES};
use crossbeam_channel::{Receiver, Sender, TryRecvError, TrySendError, bounded};
use std::{
    io::Read,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

enum Input {
    Content(String, Format),
    Pick(String),
    Replot(Box<ca_analysis::Report>),
}
type Outcome = Result<Option<Analysis>, String>;
struct Job {
    input: Input,
    language: Language,
    active: Arc<AtomicBool>,
    result: Sender<Outcome>,
    progress: Progress,
}

/// A single worker with one queued request. Each request has its own bounded
/// reply channel. Dropping that receiver makes old replies unobservable.
pub struct Session {
    worker: Option<Sender<Job>>,
    pending: Option<Job>,
    receiving: Option<Receiver<Outcome>>,
    active: Option<Arc<AtomicBool>>,
    analysis: Option<Analysis>,
    error: Option<String>,
    opened: bool,
    revision: u64,
    progress: Progress,
}

impl Default for Session {
    fn default() -> Self {
        Self::with_progress_processor(analyze_with_progress).unwrap_or_else(|_| Self {
            worker: None,
            pending: None,
            receiving: None,
            active: None,
            analysis: None,
            error: Some("analyzer.error.worker".into()),
            opened: false,
            revision: 0,
            progress: Progress::default(),
        })
    }
}

fn file(title: String, progress: &Progress) -> Result<Option<(String, Format)>, String> {
    progress.set(0, Stage::ChooseFile);
    let Some(path) = rfd::FileDialog::new()
        .set_title(title)
        .add_filter("CSV / JSON", &["csv", "json"])
        .pick_file()
    else {
        return Ok(None);
    };
    progress.set(5, Stage::Reading);
    let format = match path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("csv") => Format::Csv,
        Some("json") => Format::Json,
        _ => return Err("analyzer.error.invalid".into()),
    };
    let file = std::fs::File::open(path).map_err(|_| "analyzer.error.io")?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "analyzer.error.io")?;
    if bytes.len() > MAX_BYTES {
        return Err("analyzer.error.limit".into());
    }
    let content = String::from_utf8(bytes).map_err(|_| "analyzer.error.invalid")?;
    Ok(Some((content, format)))
}

impl Session {
    /// Processor injection supports native hosts and deterministic delayed-worker
    /// tests through the same public session boundary.
    pub fn with_processor(
        processor: impl Fn(&str, Format, Language) -> Result<Analysis, String> + Send + 'static,
    ) -> std::io::Result<Self> {
        Self::with_progress_processor(move |content, format, language, _| {
            processor(content, format, language)
        })
    }
    fn with_progress_processor(
        processor: impl Fn(&str, Format, Language, &Progress) -> Result<Analysis, String>
        + Send
        + 'static,
    ) -> std::io::Result<Self> {
        let (sender, jobs) = bounded::<Job>(1);
        std::thread::Builder::new()
            .name("fluvi-analyzer".into())
            .spawn(move || {
                while let Ok(job) = jobs.recv() {
                    if !job.active.load(Ordering::Acquire) {
                        continue;
                    }
                    let outcome = (|| {
                        let source = match job.input {
                            Input::Content(content, format) => Some((content, format)),
                            Input::Pick(title) => file(title, &job.progress)?,
                            Input::Replot(report) => {
                                job.progress.set(30, Stage::Images);
                                let plots = super::plots::render_reporting(
                                    &report,
                                    &crate::shell::Translator::new(job.language),
                                    |done| job.progress.set(30 + done as u8 * 20, Stage::Images),
                                )?;
                                return Ok(Some(Analysis {
                                    report: *report,
                                    plots,
                                    language: job.language,
                                }));
                            }
                        };
                        if !job.active.load(Ordering::Acquire) {
                            return Ok(None);
                        }
                        let Some((content, format)) = source else {
                            return Ok(None);
                        };
                        job.progress.set(10, Stage::Analyzing);
                        processor(&content, format, job.language, &job.progress).map(Some)
                    })();
                    if job.active.load(Ordering::Acquire) {
                        if matches!(outcome, Ok(Some(_))) {
                            job.progress.set(100, Stage::Ready);
                        }
                        let _ = job.result.try_send(outcome);
                    }
                }
            })?;
        Ok(Self {
            worker: Some(sender),
            pending: None,
            receiving: None,
            active: None,
            analysis: None,
            error: None,
            opened: false,
            revision: 0,
            progress: Progress::default(),
        })
    }
    pub fn open(&mut self) {
        self.opened = true;
    }
    pub fn is_open(&self) -> bool {
        self.opened
    }
    pub fn close(&mut self) {
        self.opened = false;
        self.invalidate();
    }
    fn invalidate(&mut self) {
        self.revision = self.revision.wrapping_add(1);
        if let Some(active) = self.active.take() {
            active.store(false, Ordering::Release);
        }
        self.pending = None;
        self.receiving = None;
        self.analysis = None;
        self.error = None;
        self.progress = Progress::default();
    }
    fn request(&mut self, input: Input, language: Language) {
        self.invalidate();
        if !self.opened {
            return;
        }
        let active = Arc::new(AtomicBool::new(true));
        let (result, receiving) = bounded(1);
        self.pending = Some(Job {
            input,
            language,
            active: active.clone(),
            result,
            progress: self.progress.clone(),
        });
        self.active = Some(active);
        self.receiving = Some(receiving);
    }
    pub fn load(&mut self, content: String, format: Format, language: Language) {
        self.request(Input::Content(content, format), language);
    }
    pub fn pick_file(&mut self, title: String, language: Language) {
        self.request(Input::Pick(title), language);
    }
    pub fn is_busy(&self) -> bool {
        self.pending.is_some() || self.receiving.is_some()
    }
    pub fn progress(&self) -> Option<Snapshot> {
        self.is_busy().then(|| self.progress.snapshot())
    }
    pub fn analysis(&self) -> Option<&Analysis> {
        self.analysis.as_ref()
    }
    pub fn error_key(&self) -> Option<&str> {
        self.error.as_deref()
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn set_language(&mut self, language: Language) {
        if self
            .analysis
            .as_ref()
            .is_some_and(|a| a.language != language)
        {
            let analysis = self.analysis.take().unwrap();
            self.request(Input::Replot(Box::new(analysis.report)), language);
        }
    }
    pub fn poll(&mut self) {
        if !self.opened {
            return;
        }
        if let Some(job) = self.pending.take() {
            match self.worker.as_ref().map(|w| w.try_send(job)) {
                Some(Ok(())) => {}
                Some(Err(TrySendError::Full(job))) => self.pending = Some(job),
                _ => {
                    self.error = Some("analyzer.error.worker".into());
                    self.receiving = None;
                }
            }
        }
        if let Some(receiving) = &self.receiving {
            match receiving.try_recv() {
                Ok(outcome) => {
                    self.receiving = None;
                    match outcome {
                        Ok(analysis) => self.analysis = analysis,
                        Err(error) => self.error = Some(error),
                    }
                }
                Err(TryRecvError::Disconnected) => {
                    self.receiving = None;
                    self.error = Some("analyzer.error.worker".into());
                }
                Err(TryRecvError::Empty) => {}
            }
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.invalidate();
    }
}
