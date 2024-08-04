export interface ISmtpOptions {
  banner: string;
  logger: boolean;
  disabledCommands: string[];
  secure?: boolean;
  debug?: boolean;
}

export interface IConfiguration {
  port: number;
  tmp: string;
  disableDkim: boolean;
  disableSpf: boolean;
  disableSpamScore: boolean;
  profile: boolean;
  domain_lists: string[];
}
