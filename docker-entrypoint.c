#include <errno.h>
#include <ftw.h>
#include <grp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define BUN_UID 1000
#define BUN_GID 1000

static void fail(const char *message) {
  fprintf(stderr, "bunbite-entrypoint: %s\n", message);
  exit(70);
}

static int repair_owner(const char *path, const struct stat *statbuf, int typeflag,
                        struct FTW *ftwbuf) {
  (void)statbuf;
  (void)typeflag;
  (void)ftwbuf;
  if (lchown(path, BUN_UID, BUN_GID) != 0) {
    return -1;
  }
  return 0;
}

int main(int argc, char **argv) {
  struct stat data_stat;

  if (argc < 2) {
    fail("missing application command");
  }
  if (geteuid() != 0 || getegid() != 0) {
    fail("must start as root");
  }
  if (mkdir("/data", 0755) != 0 && errno != EEXIST) {
    fail("cannot create /data");
  }
  if (lstat("/data", &data_stat) != 0 || !S_ISDIR(data_stat.st_mode)) {
    fail("/data must be a directory");
  }
  if (nftw("/data", repair_owner, 32, FTW_PHYS | FTW_DEPTH) != 0) {
    fail("/data ownership repair failed");
  }
  /* Make the runtime safe even when an orchestrator omits its own flag. */
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    fail("cannot enable no-new-privileges");
  }
  if (setgroups(0, NULL) != 0 || setgid(BUN_GID) != 0 || setuid(BUN_UID) != 0) {
    fail("cannot drop privileges to Bun UID/GID");
  }
  execv(argv[1], &argv[1]);
  fail("cannot exec application command");
}
