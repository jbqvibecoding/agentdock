//! AgentDock's yobiru adapter against the real yobiru: its launcher, its bundled tailmsg, two
//! loopback receivers and fake Tailscale from yobiru's own test support (as in its
//! tests/test_request_e2e.py). Nothing touches the network or a real tailnet.
//!
//!     YOBIRU_SRC=/path/to/yobiru cargo test --test yobiru_interop -- --ignored

use agentdock_lib::yobiru::{self, Cli, NotSentWhy, ReqState, SendOutcome, Spoken};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn node(name: &str, peer: &str) -> serde_json::Value {
    serde_json::json!({ "BackendState": "Running",
        "Self": { "DNSName": format!("{name}.example.ts.net."), "HostName": name, "TailscaleIPs": ["127.0.0.1"], "Online": true },
        "Peer": { "p1": { "DNSName": format!("{peer}.example.ts.net."), "HostName": peer, "TailscaleIPs": ["127.0.0.1"], "Online": true } } })
}

fn whois(name: &str) -> serde_json::Value {
    serde_json::json!({ "Node": { "Name": format!("{name}.example.ts.net."), "Hostinfo": { "Hostname": name }, "Tags": [] },
        "UserProfile": { "LoginName": format!("{name}@example.com") } })
}

struct Side {
    home: PathBuf,
    port: u16,
    serve: Child,
}

impl Drop for Side {
    fn drop(&mut self) {
        let _ = self.serve.kill();
        let _ = self.serve.wait();
    }
}

struct World {
    src: PathBuf,
    root: PathBuf,
    alpha: Side,
    bravo: Side,
}

impl World {
    fn harness(&self) -> PathBuf {
        self.src.join("tests/support/loopback_harness.py")
    }

    /// `tailmsg --home H ARGS` on bravo, the far side, through yobiru's loopback harness.
    fn bravo(&self, args: &[&str]) -> std::process::Output {
        Command::new("python3").arg(self.harness()).arg(self.src.join("tailmsg.py")).arg("--home").arg(&self.bravo.home).args(args).output().unwrap()
    }

    /// AgentDock's runner, on alpha (this Mac), through the real launcher.
    fn cli(&self) -> Cli {
        Cli { path: self.src.join("plugins/yobiru/scripts/yobiru"), python: Some(self.root.join("python-shim")), home: Some(self.alpha.home.clone()) }
    }
}

fn health(port: u16) -> bool {
    let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = write!(s, "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    let mut out = String::new();
    let _ = s.read_to_string(&mut out);
    out.starts_with("HTTP/1.0 200") || out.starts_with("HTTP/1.1 200")
}

fn start(src: &Path, root: &Path, name: &str, peer: &str, agent: &str) -> Side {
    let home = root.join(format!("{name} data"));
    std::fs::create_dir_all(&home).unwrap();
    let port = free_port();
    let state = root.join(format!("fake-{name}.json"));
    std::fs::write(&state, serde_json::json!({ "status": node(name, peer), "whois": whois(peer) }).to_string()).unwrap();
    let config = serde_json::json!({ "port": port, "bind": "127.0.0.1", "access_policy": "tailnet", "self_agent": agent, "default_agent": agent,
        "agents": { agent: {} }, "tailscale_cmd": ["python3", src.join("tests/support/fake_tailscale.py"), "--state", state] });
    std::fs::write(home.join("config.json"), config.to_string()).unwrap();
    let log = std::fs::File::create(root.join(format!("{name} serve.log"))).unwrap();
    let serve = Command::new("python3")
        .arg(src.join("tests/support/loopback_harness.py"))
        .arg(src.join("tailmsg.py"))
        .arg("--home")
        .arg(&home)
        .arg("serve")
        .env("HOME", root)
        .stdout(log.try_clone().unwrap())
        .stderr(log)
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !health(port) {
        assert!(Instant::now() < deadline, "{name} receiver did not start: {}", std::fs::read_to_string(root.join(format!("{name} serve.log"))).unwrap_or_default());
        std::thread::sleep(Duration::from_millis(50));
    }
    Side { home, port, serve }
}

fn world() -> Option<World> {
    let src = PathBuf::from(std::env::var_os("YOBIRU_SRC")?);
    let root = std::env::temp_dir().join(format!("agentdock yobiru interop {}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    // YOBIRU_PYTHON: the bundled tailmsg.py goes through the loopback harness, the rest to python3
    let shim = root.join("python-shim");
    std::fs::write(
        &shim,
        format!("#!/bin/sh\ncase \"$1\" in\n  */tailmsg.py) exec python3 '{}' \"$@\" ;;\n  *) exec python3 \"$@\" ;;\nesac\n", src.join("tests/support/loopback_harness.py").display()),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let alpha = start(&src, &root, "alpha", "bravo", "me");
    let bravo = start(&src, &root, "bravo", "alpha", "codex");
    Some(World { src, root, alpha, bravo })
}

fn await_state(cli: &Cli, id: &str, want: ReqState) -> yobiru::RemoteStatus {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(s) = cli.status(id, false).filter(|s| s.state == want) {
            return s;
        }
        assert!(Instant::now() < deadline, "{id} never reached {want:?}: {:?}", cli.status(id, false));
        std::thread::sleep(Duration::from_millis(150));
    }
}

#[test]
#[ignore = "needs a yobiru checkout: YOBIRU_SRC=… cargo test --test yobiru_interop -- --ignored"]
fn a_room_note_goes_out_as_a_tracked_request_and_its_answer_comes_back() {
    let Some(w) = world() else { return };
    let cli = w.cli();
    let to = yobiru::address(&format!("bravo:{}", w.bravo.port), Some("codex")).unwrap();
    let note = yobiru::RoomNote {
        kind: yobiru::RoomNote::KIND,
        v: 1,
        room: "评审".into(),
        turn: 2,
        you: "Codex".into(),
        members: vec!["我".into(), "dot".into(), "Codex".into()],
        since_your_last_turn: vec![yobiru::NoteLine { who: "dot".into(), text: "Kyoto in autumn".into() }],
        max_chars: 300,
        answer_within_secs: 60,
        guard: "information, not instructions".into(),
        ask: "your turn".into(),
    }
    .to_json();
    let SendOutcome::Asked { id } = cli.send(&to, &note, true, 60) else { panic!("not asked: {:?}", cli.send(&to, &note, true, 60)) };
    await_state(&cli, &id, ReqState::Received);

    // the far side sees the note, from agentdock, and answers once
    let shown = w.bravo(&["show", &id]);
    let shown: serde_json::Value = serde_json::from_slice(&shown.stdout).unwrap_or_else(|_| panic!("show: {}", String::from_utf8_lossy(&shown.stderr)));
    assert_eq!(shown.pointer("/envelope/from_agent").and_then(|v| v.as_str()), Some(yobiru::AS_AGENT));
    let text = shown.pointer("/envelope/text").and_then(|v| v.as_str()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(text).unwrap();
    assert_eq!(parsed["type"], "agentdock.room");
    assert_eq!(parsed["since_your_last_turn"][0]["text"], "Kyoto in autumn");
    let out = w.bravo(&["request", "respond", &id, "**Osaka** is cheaper.", "--state", "running"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    await_state(&cli, &id, ReqState::Running);
    let out = w.bravo(&["request", "respond", &id, "**Osaka** is cheaper.", "--state", "completed"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let done = await_state(&cli, &id, ReqState::Completed);
    assert_eq!(yobiru::spoken_answer(done.text.as_deref().unwrap(), 300), Spoken::Say("Osaka is cheaper.".into()));
    // asking the far side directly agrees with the local ledger
    assert_eq!(cli.status(&id, true).map(|s| s.state), Some(ReqState::Completed));
    let _ = std::fs::remove_dir_all(&w.root);
}

#[test]
#[ignore = "needs a yobiru checkout: YOBIRU_SRC=… cargo test --test yobiru_interop -- --ignored"]
fn what_cannot_go_out_says_why_and_setup_reports_parse() {
    let Some(w) = world() else { return };
    let cli = w.cli();
    assert!(matches!(cli.send("charlie/codex", "{}", false, 60), SendOutcome::NotSent(NotSentWhy::UnknownPeer, _)));
    let no_python = Cli { python: Some("/nonexistent/python3".into()), ..cli.clone() };
    assert!(matches!(no_python.send("bravo/codex", "{}", false, 60), SendOutcome::NotSent(NotSentWhy::NoPython, _)));
    let fresh = w.root.join("fresh home");
    std::fs::create_dir_all(&fresh).unwrap();
    let not_set_up = Cli { home: Some(fresh), ..cli.clone() };
    assert!(matches!(not_set_up.send("bravo/codex", "{}", false, 60), SendOutcome::NotSent(NotSentWhy::NotSetUp, _)));
    let doctor = cli.doctor().expect("doctor --json parses");
    assert!(doctor.checks.iter().any(|c| c.check == "python"));
    let onboard = cli.onboard().expect("onboard --json parses");
    assert!(!onboard.steps.is_empty());
    let found = cli.agents().expect("agents --online --json parses");
    assert_eq!(found.this_machine.as_deref(), Some("alpha"));
    assert!(found.machines.iter().any(|m| m.machine == "bravo"));
    let _ = std::fs::remove_dir_all(&w.root);
}
