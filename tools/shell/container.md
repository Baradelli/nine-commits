# A shell with no guard, run where it can only destroy a container

The post claims a shell gives the agent everything you can do. Every other
piece of evidence in commit 8 is about a guard *refusing* something, and a
refusal is only interesting if you know what it is refusing. This is what it is
refusing, run for real.

`unguarded.mjs` beside this file is `run_command` with every rule deleted:
`execSync(command, { cwd: '/work' })`. Seven lines.

## The three checks in front of it, and what they are not

They are a speed bump, not a containment boundary. In order:

1. **`--destroy-this-container` has to be on the command line.** Without it the
   file is inert. This is the only one of the three that does not depend on
   guessing where it is running, and it is the reason the file is safe to leave
   in a public repository.
2. **`/.dockerenv` has to exist.** This proves *Dockerness*, not *isolation*,
   and isolation is the property that matters. The file is present in every
   Docker container — including a VS Code dev container, which bind-mounts your
   checkout at `/workspaces/<repo>`, and a GitHub Actions `container:` job,
   which bind-mounts the workspace at `/__w`. It can be created by hand in WSL,
   where `/mnt/c` is your C: drive. On Windows it resolves to `C:\.dockerenv`,
   an ordinary file any user can touch. And it is *absent* under Podman,
   containerd and LXC, so the check is too permissive where it matters and too
   strict where it does not.
3. **None of `/workspaces`, `/__w`, `/host` or `/mnt` may hold anything.** That
   is where a dev container, a CI container, a `-v /:/host` and WSL put the
   host's files. The test is *non-empty* rather than *exists* because `/mnt`
   exists and is empty in a stock `node:22-alpine`, which is the image below.

Measured, all three, on the tree this file was written from. Each refusal is one
line in the terminal and is wrapped here to fit; the `exit 1` lines are the exit
status, which the script does not print.

```
$ node tools/shell/unguarded.mjs                      # on Windows, no flag
refusing to run: this file is an unguarded shell that deletes the filesystem it
runs on. It does nothing without --destroy-this-container on the command line.
exit 1

$ docker run --rm -i --network none node:22-alpine \
    sh -c 'cat > /work.mjs && node /work.mjs' < tools/shell/unguarded.mjs
refusing to run: this file is an unguarded shell that deletes the filesystem it
runs on. It does nothing without --destroy-this-container on the command line.
exit 1

$ docker run --rm -i --network none -v "$SCRATCH":/host:ro node:22-alpine \
    sh -c 'cat > /work.mjs && node /work.mjs --destroy-this-container' \
    < tools/shell/unguarded.mjs
refusing to run: /host holds files. That is where a dev container, a CI
container and WSL put the host's data, and this file would destroy it.
exit 1
```

The third one is the case the `/.dockerenv` check alone gets wrong: it is a
container, `/.dockerenv` is there, and the thing it would delete is yours. The
file mounted at `/host` was still there afterwards.

Do not read any of this as *it cannot run outside a container*. It can. What it
cannot do is run by accident.

## The isolation, and how it was verified

```sh
docker run --rm -i --network none \
  -e DEMO_API_KEY=DEMO-NOT-A-REAL-KEY \
  node:22-alpine \
  sh -c 'cat > /work.mjs && node /work.mjs --destroy-this-container' \
  < tools/shell/unguarded.mjs
```

The script goes in on **standard input**, not through a bind mount, because a
bind mount is a hole in exactly the claim being made. There is no `-v`, no
`--mount`, no `--volumes-from`, no `--privileged`, and `--network none`.

Verified rather than asserted. The same command was run a second time with
`--name` instead of `--rm`, so the container that did it survived to be
inspected:

```sh
docker run --name nine-shell-inspect -i --network none \
  -e DEMO_API_KEY=DEMO-NOT-A-REAL-KEY \
  node:22-alpine \
  sh -c 'cat > /work.mjs && node /work.mjs --destroy-this-container' \
  < tools/shell/unguarded.mjs
```

Its output differed from the first run's on exactly two lines, both of them the
container's own hostname (`uname -a` and `echo "I am $(whoami) on $(hostname)"`).
Then, with the format string in full so it can be run as written:

```sh
docker inspect nine-shell-inspect --format 'Mounts={{json .Mounts}} NetworkMode={{.HostConfig.NetworkMode}} Binds={{json .HostConfig.Binds}} VolumesFrom={{json .HostConfig.VolumesFrom}} Privileged={{.HostConfig.Privileged}}
Image={{.Config.Image}}
ImageID={{.Image}}'
```

```
Mounts=[] NetworkMode=none Binds=null VolumesFrom=null Privileged=false
Image=node:22-alpine
ImageID=sha256:7c3b093add7c43400ee83b815ab2cda98794a10045bcf76ce9bb2f89b97cbc5c
```

And the host was fingerprinted either side of the run — `git rev-parse HEAD`,
an MD5 of `git status --porcelain`, and an MD5 of the home directory listing:

```
before   bd2ce097e59ca216b8735efd8462f8dd1587bc15
         687e0b6d912e57bf2099897f8fd86e48   (git status)
         00bffc2c4042abc39db89b974f77997b   (ls ~)
after    bd2ce097e59ca216b8735efd8462f8dd1587bc15
         687e0b6d912e57bf2099897f8fd86e48
         00bffc2c4042abc39db89b974f77997b
```

`HEAD` is `bd2ce09`, the commit this fix round was built on top of, and the
working tree was mid-round and therefore dirty — which is why the `git status`
hash is not the hash of an empty status. What the three pairs show is that
nothing on the host moved across the run; they were taken with the same three
commands either side, minutes apart.

What this does **not** prove: a container is a kernel namespace, not a virtual
machine, and a container escape is a category of bug that exists. What it does
prove is that this run had no path to the host filesystem that Docker knew
about, and that the host was unchanged afterwards.

## The transcript

Every line below is output from the run. Nothing is edited. Two things the
script does to its own output are worth knowing before you read it: it indents
each command's output by two spaces, and **it prints only the first twelve
lines of it** (`unguarded.mjs`, `show`). `cat /etc/shadow` and `ls /` are both
cut at exactly twelve — neither is the whole file or the whole directory.

```
=== where this is running ===

$ uname -a
# the machine
  Linux 68d731b29c1e 6.6.87.1-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC Mon Apr 21 17:08:54 UTC 2025 x86_64 Linux

$ id
# who the agent is
  uid=0(root) gid=0(root) groups=0(root),1(bin),2(daemon),3(sys),4(adm),6(disk),10(wheel),11(floppy),20(dialout),26(tape),27(video)

$ ls -la /work
# the project it was given
  total 32
  drwxr-xr-x    6 root     root          4096 Sep 24 16:57 .
  drwxr-xr-x    1 root     root          4096 Sep 24 16:57 ..
  -rw-r--r--    1 root     root            33 Sep 24 16:57 README.md
  drwxr-xr-x    2 root     root          4096 Sep 24 16:57 config
  drwxr-xr-x    2 root     root          4096 Sep 24 16:57 docs
  drwxr-xr-x    2 root     root          4096 Sep 24 16:57 notes
  -rw-r--r--    1 root     root            47 Sep 24 16:57 package.json
  drwxr-xr-x    2 root     root          4096 Sep 24 16:57 src

=== things the guarded tool refuses ===

$ ls /work; echo CHAINED
# two commands in one string
  README.md
  config
  docs
  notes
  package.json
  src
  CHAINED

$ echo "echo PIPED-INTO-A-SHELL" | sh
# a pipe into a shell
  PIPED-INTO-A-SHELL

$ echo "I am $(whoami) on $(hostname)"
# command substitution
  I am root on 68d731b29c1e

$ echo PLANTED > /work/planted.txt && cat /work/planted.txt
# redirection, which is how a shell authors a file
  PLANTED

$ node -e "console.log('ARBITRARY CODE, exit code', 0)"
# an interpreter
  ARBITRARY CODE, exit code 0

$ env | grep -i -E "key|token|secret"
# the environment the process was started with
  DEMO_API_KEY=DEMO-NOT-A-REAL-KEY

$ cat /etc/shadow
# a path outside the working directory
  root:*::0:::::
  bin:!::0:::::
  daemon:!::0:::::
  lp:!::0:::::
  sync:!::0:::::
  shutdown:!::0:::::
  halt:!::0:::::
  mail:!::0:::::
  news:!::0:::::
  uucp:!::0:::::
  cron:!::0:::::
  ftp:!::0:::::

$ ls /
# the whole filesystem, from one call
  bin
  dev
  etc
  home
  lib
  media
  mnt
  opt
  proc
  root
  run
  sbin

=== the part that is not a demonstration of a guard ===

$ rm -rf /work
# delete the project
  

$ ls -la /work
# and it is gone
  exit ?

$ rm -rf --no-preserve-root /
# delete the machine
  exit ?

$ ls /
# what is left
  exit ?

$ node --version
# and the interpreter it was run with
  exit ?

=== the container is over ===
```

## What is worth reading twice

The last four calls all print `exit ?` — `ls -la /work`, `rm -rf
--no-preserve-root /`, `ls /` and `node --version` — and the tool cannot tell
any of them apart from any other. Three of them have three different causes.
`ls -la /work` fails because the directory is gone. `ls /` fails because
`/bin/ls` is gone. `node --version` fails because the Node binary is gone —
while the Node process that ran the tool is still alive, holding its own
executable's inode open, printing this transcript from a machine that no longer
exists. The fourth, `rm -rf --no-preserve-root /`, is the call that did it, and
it reports itself the same way.

That is the whole argument for the guard in one paragraph. The tool had no
opinion about any of it. `execSync` does not know the difference between `wc -l`
and `rm -rf /`; it is the same call.

And the eight lines above the deletions are the ones a guard has to earn.
`DEMO_API_KEY` came out of the process's own environment, which is the reason
`childEnvironment` in `shell.ts` builds one instead of inheriting it. `cat
/etc/shadow` is the reason every operand goes through post 6's path guard.
`echo ... > /work/planted.txt` is the reason the metacharacter rule exists and
also the reason the guarded tool cannot author content: the two are the same
rule. And `node -e` is the reason the allow-list contains no interpreter, which
is the reason the guarded tool can copy and rename but never write a byte of
its own.

## Reproducing it

```sh
docker run --rm -i --network none -e DEMO_API_KEY=DEMO-NOT-A-REAL-KEY \
  node:22-alpine sh -c 'cat > /work.mjs && node /work.mjs --destroy-this-container' \
  < tools/shell/unguarded.mjs
```

It takes a few seconds and destroys nothing you own — that container has no
mount, no volume and no network, so the only filesystem it can reach is its
own.

Running `node tools/shell/unguarded.mjs` with no arguments prints a refusal,
wherever you run it. Running it *with* `--destroy-this-container` prints a
refusal on a machine with no `/.dockerenv`, and on a container that looks like
it is holding your files — and that second test is a guess, not a guarantee. If
you are inside a container that mounts your work somewhere the list above does
not name, this file will delete it.
