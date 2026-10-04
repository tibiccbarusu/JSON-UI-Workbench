// API responses expose finite identifiers; raw parser/fs text stays out of HTTP.
export function publicErrorCode(error){
  for(const value of [error?.code,error?.message])if(typeof value==='string'&&/^[A-Z][A-Z0-9_]{2,127}$/u.test(value))return value;
  return 'NODE_OPERATION_FAILED';
}
