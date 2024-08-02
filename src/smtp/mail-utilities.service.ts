//  Source is taken from the un-maintained https://github.com/Flolagale/mailin and refactored

import { Injectable, Logger } from '@nestjs/common';
import { promisify } from 'util';
import * as child_process from 'child_process';
import * as shell from 'shelljs';
import * as path from 'path';
import * as Spamc from 'spamc';

@Injectable()
export class MailUtilitiesService {
  private readonly logger = new Logger(MailUtilitiesService.name);
  private readonly spamc = new Spamc();
  private readonly isPythonAvailable: boolean;
  private readonly isSpamcAvailable: boolean;

  constructor() {
    this.isPythonAvailable = !!shell.which('python');
    if (!this.isPythonAvailable) {
      this.logger.warn(
        'Python is not available. Dkim and spf checking is disabled.',
      );
    }
    this.isSpamcAvailable =
      !!shell.which('spamassassin') && !!shell.which('spamc');
    if (!this.isSpamcAvailable) {
      this.logger.warn(
        'Either spamassassin or spamc are not available. Spam score computation is disabled.',
      );
    }
  }

  /* @param rawEmail is the full raw mime email as a string. */
  async validateDkim(rawEmail: string): Promise<boolean> {
    if (!this.isPythonAvailable) {
      return false;
    }

    return new Promise((resolve) => {
      const verifyDkimPath = path.join(__dirname, '../python/verifydkim.py');
      const verifyDkim = child_process.spawn('python', [verifyDkimPath]);

      verifyDkim.stdout.on('data', (data) => {
        this.logger.verbose(data.toString());
      });

      verifyDkim.on('close', (code) => {
        this.logger.verbose(`closed with return code ${code}`);
        /* Convert return code to appropriate boolean. */
        resolve(!!!code);
      });

      verifyDkim.stdin.write(rawEmail);
      verifyDkim.stdin.end();
    });
  }

  async validateSpf(
    ip: string,
    address: string,
    host: string,
  ): Promise<boolean> {
    if (!this.isPythonAvailable) {
      return false;
    }

    return new Promise((resolve) => {
      const verifySpfPath = path.join(__dirname, '../python/verifyspf.py');
      const cmd = 'python';
      const args = [verifySpfPath, ip, address, host];

      child_process.execFile(cmd, args, (err, stdout) => {
        this.logger.verbose(stdout);
        const code = err ? err.code : 0;
        this.logger.verbose(`closed with return code ${code}`);
        /* Convert return code to appropriate boolean. */
        resolve(!!!code);
      });
    });
  }

  /* @param rawEmail is the full raw mime email as a string. */
  async computeSpamScore(rawEmail: string): Promise<number> {
    if (!this.isSpamcAvailable) {
      return 0.0;
    }

    const reportAsync = promisify(this.spamc.report).bind(this.spamc);

    try {
      const result = await reportAsync(rawEmail);
      this.logger.verbose(result);
      return result.spamScore;
    } catch (err) {
      this.logger.error(err);
      throw new Error('Unable to compute spam score.');
    }
  }
}
