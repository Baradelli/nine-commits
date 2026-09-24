# A shell with no guard, run where it can only destroy a container

The post claims a shell gives the agent everything you can do. Every other
piece of evidence in commit 8 is about a guard *refusing* something, and a
refusal is only interesting if you know what it is refusing. This is what it is
refusing, run for real.

`unguarded.mjs` beside this file is `run_command` with every rule deleted:
`execSync(command, { cwd: '/work' })`. Nine lines. The only guard left in it is
a check for `/.dockerenv`, which is not a safety property of the tool — it is a
refusal to leave a loaded gun in a public repository. On this machine it prints

```
refusing to run: this file is an unguarded shell and it only runs inside a
container. There is no /.dockerenv here.
```

and exits 1.

## The isolation, and how it was verified

```sh
docker run --rm -i --network none \
  -e DEMO_API_KEY=DEMO-NOT-A-REAL-KEY \
  node:22-alpine \
  sh -c 'cat > /work.mjs && node /work.mjs' \
  < tools/shell/unguarded.mjs
```

The script goes in on **standard input**, not through a bind mount, because a
bind mount is a hole in exactly the claim being made. There is no `-v`, no
`--mount`, no `--volumes-from`, no `--privileged`, and `--network none`.

Verified rather than asserted. The same command was run a second time without
`--rm` so the container that did it could be inspected, and it produced
byte-identical output apart from the container's own hostname:

```
$ docker inspect nine-shell-inspect --format 'Mounts={{json .Mounts}} NetworkMode=... '
Mounts=[] NetworkMode=none Binds=null VolumesFrom=null Privileged=false
Image=node:22-alpine
ImageID=sha256:7c3b093add7c43400ee83b815ab2cda98794a10045bcf76ce9bb2f89b97cbc5c
```

And the host was fingerprinted either side of the run — `git rev-parse HEAD`,
an MD5 of `git status --porcelain`, and an MD5 of the home directory listing:

```
before   2c6ba0af682b773db31c95229c8d2fbdf37002c0
         1e8877071d88a962147b4e31db09ed62   (git status)
         00bffc2c4042abc39db89b974f77997b   (ls ~)
after    2c6ba0af682b773db31c95229c8d2fbdf37002c0
         1e8877071d88a962147b4e31db09ed62
         00bffc2c4042abc39db89b974f77997b
```

What this does **not** prove: a container is a kernel namespace, not a virtual
machine, and a container escape is a category of bug that exists. What it does
prove is that this run had no path to the host filesystem that Docker knew
about, and that the host was unchanged afterwards.

## The transcript

Every line below is output from the run, unedited except for indentation of the
command output, which `unguarded.mjs` does itself.

```
=== where this is running ===

$ uname -a
# the machine
  Linux eacee685b73d 6.6.87.1-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC Mon Apr 21 17:08:54 UTC 2025 x86_64 Linux

$ id
# who the agent is
  uid=0(root) gid=0(root) groups=0(root),1(bin),2(daemon),3(sys),4(adm),6(disk),10(wheel),11(floppy),20(dialout),26(tape),27(video)

$ ls -la /work
# the project it was given
  total 32
  drwxr-xr-x    6 root     root          4096 Sep 24 15:23 .
  drwxr-xr-x    1 root     root          4096 Sep 24 15:23 ..
  -rw-r--r--    1 root     root            33 Sep 24 15:23 README.md
  drwxr-xr-x    2 root     root          4096 Sep 24 15:23 config
  drwxr-xr-x    2 root     root          4096 Sep 24 15:23 docs
  drwxr-xr-x    2 root     root          4096 Sep 24 15:23 notes
  -rw-r--r--    1 root     root            47 Sep 24 15:23 package.json
  drwxr-xr-x    2 root     root          4096 Sep 24 15:23 src

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
  I am root on eacee685b73d

$ echo PLANTED > /work/planted.txt && cat /work/planted.txt
# redirection, which is how a read-only shell writes files
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

The last four calls all print `exit ?`, and they print it for different reasons
that the tool cannot tell apart. `ls -la /work` fails because the directory is
gone. `ls /` fails because `/bin/ls` is gone. `node --version` fails because the
Node binary is gone — while the Node process that ran the tool is still alive,
holding its own executable's inode open, printing this transcript from a machine
that no longer exists.

That is the whole argument for the guard in one paragraph. The tool had no
opinion about any of it. `execSync` does not know the difference between `wc -l`
and `rm -rf /`; it is the same call.

And the eight lines above the deletions are the ones a guard has to earn.
`DEMO_API_KEY` came out of the process's own environment, which is the reason
`childEnvironment` in `shell.ts` builds one instead of inheriting it. `cat
/etc/shadow` is the reason every operand goes through post 6's path guard.
`echo ... > /work/planted.txt` is the reason the metacharacter rule exists and
also the reason the guarded tool cannot write a file: the two are the same rule.
And `node -e` is the reason the allow-list contains no interpreter, which is the
reason it is a read-only shell.

## Reproducing it

```sh
docker run --rm -i --network none -e DEMO_API_KEY=DEMO-NOT-A-REAL-KEY \
  node:22-alpine sh -c 'cat > /work.mjs && node /work.mjs' \
  < tools/shell/unguarded.mjs
```

It takes a few seconds and destroys nothing you own. Running
`node tools/shell/unguarded.mjs` on your own machine prints a refusal.
