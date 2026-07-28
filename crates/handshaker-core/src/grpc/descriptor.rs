//! Assemble a `prost_reflect::DescriptorPool` from a flat list of `FileDescriptorProto`s,
//! and — when one pool cannot hold the whole corpus — group several pools into a `PoolSet`.
//!
//! `prost_reflect`'s `add_file_descriptor_protos` already handles dependency ordering and
//! detects cycles / unresolved imports. We wrap it with our error type. A duplicate symbol
//! across two files is a hard error there, so `build_pool_set` falls back to one pool per
//! service, each built from that service's own transitive file closure — and, for a closure
//! that still conflicts with itself, one retry with the duplicates pruned.

use crate::error::CoreError;
use prost_reflect::DescriptorPool;
use prost_types::FileDescriptorProto;
use std::collections::{HashMap, HashSet};

const EMPTY_CORPUS: &str = "no FileDescriptorProto received from server";

/// Build a fresh pool from a list of file descriptors. Returns
/// `CoreError::DescriptorBuild` on cycles, dangling imports, or duplicate file names.
///
/// prost-reflect's message is passed through unlabelled: it is already a complete sentence,
/// and it ends up mid-sentence in the user-facing text `build_pool_set` composes on failure.
pub(crate) fn build_pool(files: Vec<FileDescriptorProto>) -> Result<DescriptorPool, CoreError> {
    if files.is_empty() {
        return Err(CoreError::DescriptorBuild(EMPTY_CORPUS.into()));
    }
    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_protos(files)
        .map_err(|e| CoreError::DescriptorBuild(e.to_string()))?;
    Ok(pool)
}

/// One or more descriptor pools plus a `service full name → pool index` map.
///
/// Healthy servers produce exactly one pool. A server that declares the same symbol in
/// two files gets one pool per service, so a conflict between two services no longer
/// costs the whole endpoint.
#[derive(Clone, Debug, Default)]
pub struct PoolSet {
    pools: Vec<DescriptorPool>,
    by_service: HashMap<String, usize>,
}

impl PoolSet {
    /// Wrap one already-assembled pool, indexing every service it declares.
    pub fn from_pool(pool: DescriptorPool) -> Self {
        let mut set = Self::default();
        set.push(pool);
        set
    }

    /// The pool that can resolve `full_name`, or `None` if no pool declares that service.
    pub fn for_service(&self, full_name: &str) -> Option<&DescriptorPool> {
        self.by_service.get(full_name).map(|&i| &self.pools[i])
    }

    /// Every pool, in insertion order. Used to project the catalog.
    pub fn pools(&self) -> impl Iterator<Item = &DescriptorPool> {
        self.pools.iter()
    }

    /// How many pools back this set. `1` means the fast path held.
    pub fn pool_count(&self) -> usize {
        self.pools.len()
    }

    fn push(&mut self, pool: DescriptorPool) {
        let idx = self.pools.len();
        // Collect first: `pool.services()` borrows `pool`, which we are about to move.
        let names: Vec<String> = pool.services().map(|s| s.full_name().to_string()).collect();
        self.pools.push(pool);
        for name in names {
            // First definition wins: two files may declare the same service full name, and
            // stage 2 gives each of them its own pool. Stage 2 visits roots in file-name
            // order, so the winner is the copy from the lexicographically first file —
            // the same copy on every run, whatever order the caller handed us the files in.
            self.by_service.entry(name).or_insert(idx);
        }
    }
}

/// Assemble `files` into a `PoolSet`.
///
/// Stage 1: one pool for everything — the fast path, and what healthy servers use.
/// Stage 2: on any stage-1 failure, one pool per service, built from that service's own
/// transitive `dependency` closure. Cross-service duplicate symbols vanish here because
/// the two copies land in different pools.
/// Stage 3: a closure that duplicates a symbol against *itself* is retried once with the
/// later definitions pruned. A service that still cannot be assembled is skipped, not
/// fatal; only an empty result fails. Services are visited in file-name order, so the
/// result does not depend on how the caller ordered `files` (given distinct file names —
/// duplicates are already collapsed upstream).
pub fn build_pool_set(files: &[FileDescriptorProto]) -> Result<PoolSet, CoreError> {
    if files.is_empty() {
        return Err(CoreError::DescriptorBuild(EMPTY_CORPUS.into()));
    }

    // Why stage 1 failed is the most diagnostic fact about a misbehaving endpoint, and
    // stage 2 usually succeeds — so unless we report it here, nobody ever learns why the
    // endpoint left the fast path. It also stands in as the cause when stage 2 salvages
    // nothing, including when the corpus declares no service at all.
    let stage1_cause = match build_pool(files.to_vec()) {
        Ok(pool) => return Ok(PoolSet::from_pool(pool)),
        // Unwrap the payload: re-wrapping it below would render a second
        // "descriptor build failed:" inside the user-facing message.
        Err(CoreError::DescriptorBuild(msg)) => msg,
        Err(e) => e.to_string(),
    };
    eprintln!("descriptor pool: single-pool assembly failed, isolating: {stage1_cause}");

    let index: HashMap<&str, &FileDescriptorProto> = files.iter().map(|f| (f.name(), f)).collect();

    // Roots in file-name order: the caller's slice order is not meaningful (the reflection
    // crawler collects from a HashMap), and pool order decides which copy of a duplicated
    // service name `PoolSet::push` keeps.
    let mut roots: Vec<&FileDescriptorProto> =
        files.iter().filter(|f| !f.service.is_empty()).collect();
    roots.sort_by(|a, b| a.name().cmp(b.name()));

    let mut set = PoolSet::default();
    for file in roots {
        // Stage 3: a closure that conflicts with itself gets one retry with its duplicate
        // top-level symbols pruned. Only on failure — pruning is lossy, so the untouched
        // closure always gets the first say.
        let closure = service_closure(&index, file);
        let built =
            build_pool(closure.clone()).or_else(|_| build_pool(prune_duplicate_symbols(closure)));
        match built {
            Ok(pool) => set.push(pool),
            // Non-fatal: a service we cannot assemble costs only itself. The detail goes to
            // stderr; the returned error, if it comes to that, names the stage-1 cause.
            Err(e) => {
                eprintln!("descriptor pool: skipping services declared in {}: {e}", file.name())
            }
        }
    }

    if set.pool_count() == 0 {
        return Err(CoreError::DescriptorBuild(format!(
            "no service could be assembled from the server's descriptors: {stage1_cause}"
        )));
    }
    Ok(set)
}

/// The transitive `dependency` closure of `root`, `root` itself first and the rest sorted
/// by file name so the result is deterministic. Cycles terminate. Dependencies missing from
/// `index` are skipped — the pool build is what reports them.
fn service_closure<'a>(
    index: &HashMap<&'a str, &'a FileDescriptorProto>,
    root: &'a FileDescriptorProto,
) -> Vec<FileDescriptorProto> {
    // Seed from `root` itself, not from `index[root.name()]`: a corpus with two files under
    // one name is exactly a stage-1 failure this fallback has to cope with, and the index
    // holds only one of them.
    let mut seen: HashSet<&str> = HashSet::from([root.name()]);
    let mut closure = vec![root.clone()];
    let mut stack: Vec<&str> = root.dependency.iter().map(String::as_str).collect();

    while let Some(name) = stack.pop() {
        if !seen.insert(name) {
            continue;
        }
        let Some(file) = index.get(name) else {
            continue;
        };
        for dep in &file.dependency {
            if !seen.contains(dep.as_str()) {
                stack.push(dep);
            }
        }
        closure.push((*file).clone());
    }

    closure[1..].sort_by(|a, b| a.name().cmp(b.name()));
    closure
}

/// Drop duplicate **top-level** definitions from `files`, keeping the first file that
/// declares each fully-qualified name and giving the losing file a `dependency` on the
/// winner so its surviving references still resolve.
///
/// Only top-level names are compared: a nested type is reachable only through its parent,
/// so dropping the parent takes its nested types with it.
///
/// This is lossy — where two copies differ, the first one wins for everybody in the
/// closure. It runs only after per-service isolation has already failed. `files` comes from
/// `service_closure`, so "first" means the root, then the lowest file name.
///
/// `source_code_info` is left as-is: its `location[].path` index paths point into the
/// vectors pruned here, so they are stale afterwards. Nothing reads it today (reflection
/// responses omit it); clear it here if that ever changes.
fn prune_duplicate_symbols(mut files: Vec<FileDescriptorProto>) -> Vec<FileDescriptorProto> {
    // fully-qualified name -> name of the file that owns it
    let mut owner: HashMap<String, String> = HashMap::new();

    for file in files.iter_mut() {
        let package = file.package().to_string();
        let file_name = file.name().to_string();
        let mut extra_deps: HashSet<String> = HashSet::new();

        // Scoped so `keep`'s borrows of `owner` and `extra_deps` end before we read them.
        {
            let mut keep = |name: &str| {
                let full_name =
                    if package.is_empty() { name.to_string() } else { format!("{package}.{name}") };
                match owner.get(&full_name) {
                    None => {
                        owner.insert(full_name, file_name.clone());
                        true
                    }
                    Some(first) => {
                        if first != &file_name {
                            extra_deps.insert(first.clone());
                        }
                        false
                    }
                }
            };

            file.message_type.retain(|m| keep(m.name()));
            file.enum_type.retain(|e| keep(e.name()));
            file.extension.retain(|x| keep(x.name()));
            file.service.retain(|s| keep(s.name()));
        }

        // Sorted for determinism only: `dependency` is a set as far as name resolution is
        // concerned (prost-reflect checks membership in a `transitive_dependencies`
        // HashSet), but draining a HashSet would write a different file order on every
        // run. Appending is safe — `public_dependency` / `weak_dependency` index into
        // `dependency`, and existing indices keep pointing at the same entries.
        let mut extra_deps: Vec<String> = extra_deps.into_iter().collect();
        extra_deps.sort();
        for dep in extra_deps {
            if !file.dependency.contains(&dep) {
                file.dependency.push(dep);
            }
        }
    }

    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost_types::{
        field_descriptor_proto::Type as FieldType, DescriptorProto, EnumDescriptorProto,
        EnumValueDescriptorProto, FieldDescriptorProto, FileDescriptorProto,
        MethodDescriptorProto, ServiceDescriptorProto,
    };

    fn make_simple_file() -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some("test/echo.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![
                DescriptorProto {
                    name: Some("Ping".into()),
                    field: vec![FieldDescriptorProto {
                        name: Some("id".into()),
                        number: Some(1),
                        r#type: Some(FieldType::String as i32),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                DescriptorProto {
                    name: Some("Pong".into()),
                    field: vec![FieldDescriptorProto {
                        name: Some("id".into()),
                        number: Some(1),
                        r#type: Some(FieldType::String as i32),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            service: vec![ServiceDescriptorProto {
                name: Some("Echo".into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Send".into()),
                    input_type: Some(".test.Ping".into()),
                    output_type: Some(".test.Pong".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn empty_input_rejected() {
        let err = build_pool(vec![]).unwrap_err();
        assert!(matches!(err, CoreError::DescriptorBuild(_)));
    }

    #[test]
    fn single_file_builds_and_resolves_service() {
        let pool = build_pool(vec![make_simple_file()]).expect("build pool");
        let svc = pool
            .get_service_by_name("test.Echo")
            .expect("Echo service must be in pool");
        assert_eq!(svc.full_name(), "test.Echo");
        assert_eq!(svc.methods().count(), 1);
        let m = svc.methods().next().unwrap();
        assert_eq!(m.name(), "Send");
        assert_eq!(m.input().full_name(), "test.Ping");
        assert_eq!(m.output().full_name(), "test.Pong");
    }

    #[test]
    fn unresolved_import_is_rejected() {
        let bad = FileDescriptorProto {
            name: Some("a.proto".into()),
            package: Some("a".into()),
            syntax: Some("proto3".into()),
            dependency: vec!["missing/b.proto".into()],
            ..Default::default()
        };
        let err = build_pool(vec![bad]).unwrap_err();
        assert!(matches!(err, CoreError::DescriptorBuild(_)));
    }

    #[test]
    fn healthy_corpus_uses_a_single_pool() {
        let set = build_pool_set(&[make_simple_file()]).expect("build pool set");
        assert_eq!(set.pool_count(), 1, "healthy corpus must not leave the fast path");
        assert!(set
            .for_service("test.Echo")
            .unwrap()
            .get_service_by_name("test.Echo")
            .is_some());
        assert!(set.for_service("test.Nope").is_none());
    }

    #[test]
    fn empty_input_rejected_by_pool_set() {
        let err = build_pool_set(&[]).unwrap_err();
        match err {
            // Assert the *sentence*, not just the variant. Deleting the empty guard here
            // still errors — stage 1 rejects the empty corpus and stage 2 salvages nothing —
            // but the user would then read "no service could be assembled…", which blames
            // the services of a server that in fact said nothing at all.
            CoreError::DescriptorBuild(msg) => assert_eq!(msg, EMPTY_CORPUS),
            other => panic!("expected DescriptorBuild, got {other:?}"),
        }
    }

    /// One file: `package test; message Shared { string <field> = 1; }
    /// service <svc> { rpc Call (Shared) returns (Shared); }`
    fn file_with_own_shared(file: &str, svc: &str, field: &str) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some("Shared".into()),
                field: vec![FieldDescriptorProto {
                    name: Some(field.into()),
                    number: Some(1),
                    r#type: Some(FieldType::String as i32),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            service: vec![ServiceDescriptorProto {
                name: Some(svc.into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Call".into()),
                    input_type: Some(".test.Shared".into()),
                    output_type: Some(".test.Shared".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn duplicate_symbol_across_services_isolates_into_one_pool_each() {
        let files = vec![
            file_with_own_shared("a.proto", "SvcA", "a_only"),
            file_with_own_shared("b.proto", "SvcB", "b_only"),
        ];
        // Sanity: the single-pool path really does reject this corpus.
        assert!(build_pool(files.clone()).is_err());

        let set = build_pool_set(&files).expect("isolation must rescue this corpus");
        assert_eq!(set.pool_count(), 2);

        let a = set.for_service("test.SvcA").expect("SvcA resolves");
        let b = set.for_service("test.SvcB").expect("SvcB resolves");

        // Each service must see ITS OWN copy of test.Shared, not the other's.
        let a_shared = a.get_message_by_name("test.Shared").unwrap();
        let b_shared = b.get_message_by_name("test.Shared").unwrap();
        assert!(a_shared.get_field_by_name("a_only").is_some());
        assert!(a_shared.get_field_by_name("b_only").is_none());
        assert!(b_shared.get_field_by_name("b_only").is_some());
        assert!(b_shared.get_field_by_name("a_only").is_none());
    }

    /// `package test; message Payload { string p = 1; }` — no service, imported by others.
    fn dep_file() -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some("dep.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some("Payload".into()),
                field: vec![FieldDescriptorProto {
                    name: Some("p".into()),
                    number: Some(1),
                    r#type: Some(FieldType::String as i32),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn service_pool_pulls_in_its_imported_files() {
        // SvcA answers with a message it imports, so its pool is unbuildable without the
        // closure; SvcB conflicts with it on `test.Shared`, which is what forces stage 2.
        let mut a = file_with_own_shared("a.proto", "SvcA", "a_only");
        a.dependency = vec!["dep.proto".into()];
        a.service[0].method[0].output_type = Some(".test.Payload".into());
        let files = vec![a, file_with_own_shared("b.proto", "SvcB", "b_only"), dep_file()];

        let set = build_pool_set(&files).expect("isolation must rescue this corpus");
        assert_eq!(set.pool_count(), 2, "dep.proto declares no service, so it is not a root");

        let a_pool = set.for_service("test.SvcA").expect("SvcA resolves");
        assert!(a_pool.get_message_by_name("test.Payload").is_some(), "import came along");
        let b_pool = set.for_service("test.SvcB").expect("SvcB resolves");
        assert!(
            b_pool.get_message_by_name("test.Payload").is_none(),
            "a file nobody imports must not leak into another service's pool"
        );
    }

    #[test]
    fn cyclic_dependencies_terminate() {
        let mut a = file_with_own_shared("a.proto", "SvcA", "a_only");
        a.dependency = vec!["b.proto".into()];
        let mut b = file_with_own_shared("b.proto", "SvcB", "b_only");
        b.dependency = vec!["a.proto".into()];
        let index: HashMap<&str, &FileDescriptorProto> =
            [(a.name(), &a), (b.name(), &b)].into_iter().collect();

        let closure = service_closure(&index, &a);
        let names: Vec<&str> = closure.iter().map(|f| f.name()).collect();
        assert_eq!(names, ["a.proto", "b.proto"], "each file visited exactly once, root first");
    }

    #[test]
    fn duplicate_service_name_resolves_to_the_first_file_whatever_the_input_order() {
        let mut x = file_with_own_shared("x.proto", "Dup", "x_only");
        x.service[0].method[0].name = Some("FromX".into());
        let mut y = file_with_own_shared("y.proto", "Dup", "y_only");
        y.service[0].method[0].name = Some("FromY".into());

        for files in [vec![x.clone(), y.clone()], vec![y, x]] {
            let set = build_pool_set(&files).expect("isolation must rescue this corpus");
            assert_eq!(set.pool_count(), 2);
            let svc = set
                .for_service("test.Dup")
                .unwrap()
                .get_service_by_name("test.Dup")
                .expect("the winning pool must resolve the service");
            assert_eq!(
                svc.methods().next().unwrap().name(),
                "FromX",
                "lowest file name wins, so the winner cannot depend on slice order"
            );
        }
    }

    /// `package test; service <svc> { rpc Call (Shared) returns (Shared); }` importing a
    /// file the server never returned — unassemblable on its own.
    fn file_with_dangling_import(file: &str, svc: &str) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            dependency: vec!["never/sent.proto".into()],
            service: vec![ServiceDescriptorProto {
                name: Some(svc.into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Call".into()),
                    input_type: Some(".test.Shared".into()),
                    output_type: Some(".test.Shared".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn unassemblable_service_is_skipped_others_survive() {
        let files = vec![
            file_with_own_shared("a.proto", "SvcA", "a_only"),
            file_with_own_shared("b.proto", "SvcB", "b_only"),
            file_with_dangling_import("c.proto", "SvcC"),
        ];
        let set = build_pool_set(&files).expect("two healthy services must survive");
        assert_eq!(set.pool_count(), 2);
        assert!(set.for_service("test.SvcA").is_some());
        assert!(set.for_service("test.SvcB").is_some());
        assert!(set.for_service("test.SvcC").is_none());
    }

    #[test]
    fn no_assemblable_service_is_fatal() {
        let err = build_pool_set(&[file_with_dangling_import("c.proto", "SvcC")]).unwrap_err();
        match err {
            CoreError::DescriptorBuild(msg) => {
                assert!(msg.contains("no service could be assembled"), "got: {msg}");
                // The stage-1 cause is the diagnostic payload; assert on what prost-reflect
                // actually said, not only on the literal this file authors.
                assert!(msg.contains("never/sent.proto"), "stage-1 cause must survive: {msg}");
                assert!(!msg.contains("descriptor build failed"), "no nested prefix: {msg}");
            }
            other => panic!("expected DescriptorBuild, got {other:?}"),
        }
    }

    /// `package test; message <msg> { string <field> = 1; }` in its own file.
    fn file_with_message(file: &str, msg: &str, field: &str) -> FileDescriptorProto {
        file_with_message_in(file, "test", msg, field)
    }

    /// `package <pkg>; message <msg> { string <field> = 1; }` in its own file.
    fn file_with_message_in(file: &str, pkg: &str, msg: &str, field: &str) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(file.into()),
            package: Some(pkg.into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some(msg.into()),
                field: vec![FieldDescriptorProto {
                    name: Some(field.into()),
                    number: Some(1),
                    r#type: Some(FieldType::String as i32),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// svc.proto imports both dep1.proto and dep2.proto, and BOTH declare test.Dup.
    /// dep2.proto also declares test.Other, which nothing else does.
    ///
    /// `Other.d` deliberately references `.test.Dup` — the symbol dep2.proto is about to
    /// lose. That is what forces pruning to hand the loser a `dependency` on the winner:
    /// without the added import the retry fails with `name 'test.Dup' is not defined`.
    fn self_conflicting_closure() -> Vec<FileDescriptorProto> {
        let mut dep2 = file_with_message("dep2.proto", "Dup", "from_dep2");
        dep2.message_type.push(DescriptorProto {
            name: Some("Other".into()),
            field: vec![
                FieldDescriptorProto {
                    name: Some("z".into()),
                    number: Some(1),
                    r#type: Some(FieldType::String as i32),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("d".into()),
                    number: Some(2),
                    r#type: Some(FieldType::Message as i32),
                    type_name: Some(".test.Dup".into()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        });

        let svc = FileDescriptorProto {
            name: Some("svc.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            dependency: vec!["dep1.proto".into(), "dep2.proto".into()],
            service: vec![ServiceDescriptorProto {
                name: Some("SvcD".into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Call".into()),
                    input_type: Some(".test.Dup".into()),
                    output_type: Some(".test.Other".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };

        vec![file_with_message("dep1.proto", "Dup", "from_dep1"), dep2, svc]
    }

    #[test]
    fn duplicate_inside_one_closure_is_pruned_service_survives() {
        let files = self_conflicting_closure();
        let set = build_pool_set(&files).expect("pruning must rescue this closure");

        let pool = set.for_service("test.SvcD").expect("SvcD resolves");
        let dup = pool.get_message_by_name("test.Dup").unwrap();
        // dep1.proto sorts before dep2.proto, so its definition wins.
        assert!(dup.get_field_by_name("from_dep1").is_some());
        assert!(dup.get_field_by_name("from_dep2").is_none());
        // The losing file keeps everything that was not a duplicate.
        let other = pool.get_message_by_name("test.Other").expect("test.Other survives");
        // ...and its reference to the symbol it lost still resolves — to the winner's copy.
        // This only holds because pruning gave dep2.proto an import of dep1.proto.
        let d = other.get_field_by_name("d").expect("Other.d survives");
        let referenced = d.kind().as_message().expect("Other.d is a message field").clone();
        assert_eq!(referenced.full_name(), "test.Dup");
        assert!(referenced.get_field_by_name("from_dep1").is_some(), "resolved to the winner");
    }

    #[test]
    fn pruning_winner_follows_file_name_order_not_input_order() {
        // `service_closure` sorts the non-root files, so the surviving copy of a duplicate
        // must not depend on the order the server listed the files in.
        let mut reversed = self_conflicting_closure();
        reversed.reverse();
        let set = build_pool_set(&reversed).expect("pruning must rescue this closure");
        let dup = set
            .for_service("test.SvcD")
            .expect("SvcD resolves")
            .get_message_by_name("test.Dup")
            .unwrap();
        assert!(dup.get_field_by_name("from_dep1").is_some(), "lowest file name still wins");
        assert!(dup.get_field_by_name("from_dep2").is_none());
    }

    #[test]
    fn pruning_compares_fully_qualified_names_not_simple_ones() {
        // `pkg_a.Foo` and `pkg_b.Foo` are two DIFFERENT messages that happen to share a
        // simple name. Pruning on the simple name would silently delete one of them and
        // hand its users the other one's fields — the exact corruption that per-service
        // isolation runs *before* pruning to avoid.
        let mut files = self_conflicting_closure();
        files.push(file_with_message_in("pkg_a.proto", "pkg_a", "Foo", "from_a"));
        files.push(file_with_message_in("pkg_b.proto", "pkg_b", "Foo", "from_b"));
        // Pull both into svc.proto's closure, which already needs stage-3 pruning.
        let svc = files.iter_mut().find(|f| f.name() == "svc.proto").expect("svc.proto");
        svc.dependency.push("pkg_a.proto".into());
        svc.dependency.push("pkg_b.proto".into());

        let set = build_pool_set(&files).expect("pruning must rescue this closure");
        let pool = set.for_service("test.SvcD").expect("SvcD resolves");
        let a = pool.get_message_by_name("pkg_a.Foo").expect("pkg_a.Foo survives");
        let b = pool.get_message_by_name("pkg_b.Foo").expect("pkg_b.Foo survives");
        assert!(a.get_field_by_name("from_a").is_some());
        assert!(b.get_field_by_name("from_b").is_some(), "another package, another symbol");
    }

    #[test]
    fn pruning_keeps_the_roots_copy_even_when_its_file_name_sorts_last() {
        // The root sits at closure index 0 by construction, not by name — that is what makes
        // a service's OWN copy of a DTO beat the one it imports. `zsvc.proto` sorts after
        // `dep.proto`, so sorting the whole closure would flip the winner.
        let mut root = file_with_message("zsvc.proto", "Dup", "from_root");
        root.dependency = vec!["dep.proto".into()];
        root.service = vec![ServiceDescriptorProto {
            name: Some("SvcZ".into()),
            method: vec![MethodDescriptorProto {
                name: Some("Call".into()),
                input_type: Some(".test.Dup".into()),
                output_type: Some(".test.Dup".into()),
                ..Default::default()
            }],
            ..Default::default()
        }];
        let files = vec![root, file_with_message("dep.proto", "Dup", "from_dep")];

        let set = build_pool_set(&files).expect("pruning must rescue this closure");
        let dup = set
            .for_service("test.SvcZ")
            .expect("SvcZ resolves")
            .get_message_by_name("test.Dup")
            .unwrap();
        assert!(dup.get_field_by_name("from_root").is_some(), "the root's own copy wins");
        assert!(dup.get_field_by_name("from_dep").is_none());
    }

    /// `package test; enum <name> { <value> = 0; }` in its own file, no service.
    fn file_with_enum(file: &str, name: &str, value: &str) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            enum_type: vec![EnumDescriptorProto {
                name: Some(name.into()),
                value: vec![EnumValueDescriptorProto {
                    name: Some(value.into()),
                    number: Some(0),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// `package test; message <msg> { string q = 1; }
    /// service <svc> { rpc Call (<msg>) returns (<msg>); }` importing `deps`.
    fn root_service_file(file: &str, svc: &str, msg: &str, deps: &[&str]) -> FileDescriptorProto {
        let mut f = file_with_message(file, msg, "q");
        f.dependency = deps.iter().map(|d| (*d).to_string()).collect();
        f.service = vec![ServiceDescriptorProto {
            name: Some(svc.into()),
            method: vec![MethodDescriptorProto {
                name: Some("Call".into()),
                input_type: Some(format!(".test.{msg}")),
                output_type: Some(format!(".test.{msg}")),
                ..Default::default()
            }],
            ..Default::default()
        }];
        f
    }

    #[test]
    fn duplicate_enum_inside_one_closure_is_pruned_service_survives() {
        // Messages are not the only top-level symbol a code-first server duplicates.
        let files = vec![
            file_with_enum("edep1.proto", "Color", "FROM_EDEP1"),
            file_with_enum("edep2.proto", "Color", "FROM_EDEP2"),
            root_service_file("esvc.proto", "ESvc", "EReq", &["edep1.proto", "edep2.proto"]),
        ];
        assert!(build_pool(files.clone()).is_err(), "sanity: one pool cannot hold this");

        let set = build_pool_set(&files).expect("pruning must rescue this closure");
        let color = set
            .for_service("test.ESvc")
            .expect("ESvc resolves")
            .get_enum_by_name("test.Color")
            .expect("test.Color survives");
        assert!(color.get_value_by_name("FROM_EDEP1").is_some(), "edep1.proto sorts first");
        assert!(color.get_value_by_name("FROM_EDEP2").is_none());
    }

    /// proto2 `package test; extend XBase { optional string <name> = <number>; }`, importing
    /// the file that declares the extendee. proto2 because proto3 only lets you extend
    /// option messages, which would drag descriptor.proto into the fixture.
    fn file_with_extension(file: &str, name: &str, number: i32) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            dependency: vec!["xbase.proto".into()],
            extension: vec![FieldDescriptorProto {
                name: Some(name.into()),
                number: Some(number),
                label: Some(prost_types::field_descriptor_proto::Label::Optional as i32),
                r#type: Some(FieldType::String as i32),
                extendee: Some(".test.XBase".into()),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn duplicate_extension_inside_one_closure_is_pruned_service_survives() {
        // proto2 `message XBase { extensions 100 to 200; }` — the extendee.
        let base = FileDescriptorProto {
            name: Some("xbase.proto".into()),
            package: Some("test".into()),
            message_type: vec![DescriptorProto {
                name: Some("XBase".into()),
                extension_range: vec![prost_types::descriptor_proto::ExtensionRange {
                    start: Some(100),
                    end: Some(200),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let files = vec![
            base,
            file_with_extension("xdep1.proto", "xt", 100),
            file_with_extension("xdep2.proto", "xt", 101),
            root_service_file("xsvc.proto", "XSvc", "XReq", &["xdep1.proto", "xdep2.proto"]),
        ];
        assert!(build_pool(files.clone()).is_err(), "sanity: one pool cannot hold this");

        let set = build_pool_set(&files).expect("pruning must rescue this closure");
        let ext = set
            .for_service("test.XSvc")
            .expect("XSvc resolves")
            .get_extension_by_name("test.xt")
            .expect("test.xt survives");
        assert_eq!(ext.number(), 100, "xdep1.proto sorts first, so its copy is the one kept");
    }

    #[test]
    fn duplicate_service_inside_one_closure_is_pruned_service_survives() {
        // Two imported files declare the same service name. Pruning has to drop one of them
        // too, or the importing service's own pool never assembles and it is skipped.
        let dup_service = |input: &str| ServiceDescriptorProto {
            name: Some("Both".into()),
            method: vec![MethodDescriptorProto {
                name: Some("Call".into()),
                input_type: Some(input.into()),
                output_type: Some(input.into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut d1 = file_with_message("sdep1.proto", "D1", "from_sdep1");
        d1.service = vec![dup_service(".test.D1")];
        let mut d2 = file_with_message("sdep2.proto", "D2", "from_sdep2");
        d2.service = vec![dup_service(".test.D2")];
        let files = vec![
            d1,
            d2,
            root_service_file("ssvc.proto", "Main", "SReq", &["sdep1.proto", "sdep2.proto"]),
        ];

        let set = build_pool_set(&files).expect("pruning must rescue this closure");
        let pool = set.for_service("test.Main").expect("Main resolves, so its closure assembled");
        let both = pool.get_service_by_name("test.Both").expect("one copy of test.Both survives");
        assert_eq!(
            both.methods().next().unwrap().input().full_name(),
            "test.D1",
            "sdep1.proto sorts first, so its copy of the service is the one kept"
        );
    }
}
