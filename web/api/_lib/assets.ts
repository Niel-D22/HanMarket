// HanMarket asset catalogue: Hong Kong main-board listings and US-listed China ADRs / ETFs.
// Serverless copy of api/src/assets.ts, used by the Vercel functions in web/api.
//
// pythFeedId: Pyth price feed (https://pyth.network/price-feeds). HK feeds quote in HKD, ADRs in USD.
// yahoo: ticker used as the free fallback quote source when no Pyth API key is configured.

export type Board = 'HK' | 'ADR';

export interface ChinaAsset {
  symbol: string;      // on-chain / API symbol, e.g. "0700.HK", "BABA"
  name: string;
  cn: string;
  board: Board;
  currency: 'HKD' | 'USD';
  pythFeedId: string;
  yahoo: string;
  /** ticker in Robinhood's Stock Token API, when they have tokenized it (BABA, FUTU today) */
  rhToken?: string;
}

export const ASSETS: ChinaAsset[] = [
  // Hong Kong (港股)
  { symbol: '0700.HK', name: 'Tencent', cn: '腾讯控股', board: 'HK', currency: 'HKD', yahoo: '0700.HK', pythFeedId: '2229ed6410e4f9e0a91b74a2f08c3048cfb6c2c80b3f1a4dbbfb8765b653cef1' },
  { symbol: '9988.HK', name: 'Alibaba', cn: '阿里巴巴', board: 'HK', currency: 'HKD', yahoo: '9988.HK', pythFeedId: '2920e88a90a1b49ee633abc4bc0c4b399f01764d51fcfae8b93da6d2aa0fcb58' },
  { symbol: '3690.HK', name: 'Meituan', cn: '美团', board: 'HK', currency: 'HKD', yahoo: '3690.HK', pythFeedId: '319b800060fb51b527409057632a5d8d60fc84f59ea0892cb23d91a1fb8b25c4' },
  { symbol: '1810.HK', name: 'Xiaomi', cn: '小米集团', board: 'HK', currency: 'HKD', yahoo: '1810.HK', pythFeedId: 'f4481e13c8640b78f48407c2db150f42a2e6861e173bb54ed50abe142d5cf62d' },
  { symbol: '1211.HK', name: 'BYD', cn: '比亚迪股份', board: 'HK', currency: 'HKD', yahoo: '1211.HK', pythFeedId: '491d2a4356b490d041a34730ad7fe54f7ed0483e6eb7a279feca7fe4b61fa4da' },
  { symbol: '9618.HK', name: 'JD.com', cn: '京东集团', board: 'HK', currency: 'HKD', yahoo: '9618.HK', pythFeedId: '560cce1d2a2ab99b1d0cc828d970ba631598fe7d69b0998959b61a188b82c17b' },
  { symbol: '1024.HK', name: 'Kuaishou', cn: '快手', board: 'HK', currency: 'HKD', yahoo: '1024.HK', pythFeedId: '6c1cfa413bf864a8887a74319e7e1c6df33656971f0393a5e7afac87d95b0839' },
  { symbol: '0981.HK', name: 'SMIC', cn: '中芯国际', board: 'HK', currency: 'HKD', yahoo: '0981.HK', pythFeedId: '155d8e7ffcc9c67eb227d4adbd153ba69cfef803eeb077c902f9095bf1afae64' },
  { symbol: '9999.HK', name: 'NetEase', cn: '网易', board: 'HK', currency: 'HKD', yahoo: '9999.HK', pythFeedId: '088415ee575b594758152ed1142774e878d70ef9b5b2b9a41202fb7a4fbb0f3a' },
  { symbol: '9888.HK', name: 'Baidu', cn: '百度集团', board: 'HK', currency: 'HKD', yahoo: '9888.HK', pythFeedId: '0df0e9628ac319fd8b7f64e3529f35642d568173e1e42009740424408f7e36a8' },
  { symbol: '2015.HK', name: 'Li Auto', cn: '理想汽车', board: 'HK', currency: 'HKD', yahoo: '2015.HK', pythFeedId: '51d6595b72b9771f8b84e62cb5f6a97013776527af037ea6dd7a62c446ce5c56' },
  { symbol: '2318.HK', name: 'Ping An', cn: '中国平安', board: 'HK', currency: 'HKD', yahoo: '2318.HK', pythFeedId: '8a6a69373c72a42788524054762ce0a99cd4d0423449dd66a02386d329ccd1a5' },
  { symbol: '0941.HK', name: 'China Mobile', cn: '中国移动', board: 'HK', currency: 'HKD', yahoo: '0941.HK', pythFeedId: 'ea6176f06bcd2615b3b60d004f61f1a05ef656523d41797de0b8ceead86e2b6f' },
  { symbol: '0388.HK', name: 'HKEX', cn: '香港交易所', board: 'HK', currency: 'HKD', yahoo: '0388.HK', pythFeedId: '1f7983cbd3c3f592b0990c80c6d3c217d09379770b557a7544c47be185562707' },
  { symbol: '0005.HK', name: 'HSBC', cn: '汇丰控股', board: 'HK', currency: 'HKD', yahoo: '0005.HK', pythFeedId: '6d726c65fc24263017ac4314ecbe80d3fef07f0762677a12f294b994f544880b' },

  // US-listed China ADRs & ETFs (中概股)
  { symbol: 'BABA', name: 'Alibaba ADR', cn: '阿里巴巴', board: 'ADR', currency: 'USD', yahoo: 'BABA', rhToken: 'BABA', pythFeedId: '72bc23b1d0afb1f8edef20b7fb60982298993161bc0fd749587d6f60cd1ee9a3' },
  { symbol: 'PDD', name: 'PDD Holdings', cn: '拼多多', board: 'ADR', currency: 'USD', yahoo: 'PDD', pythFeedId: 'ae69f62081eb15ae4f077397871a1cf29cacf75e7b1db740aed9074c1efd3fa4' },
  { symbol: 'JD', name: 'JD.com ADR', cn: '京东', board: 'ADR', currency: 'USD', yahoo: 'JD', pythFeedId: '4c45e26d5253283ab4736b4f4ba9d0e6517679f8425ef07722dacc4b6da90750' },
  { symbol: 'BIDU', name: 'Baidu ADR', cn: '百度', board: 'ADR', currency: 'USD', yahoo: 'BIDU', pythFeedId: '9bdee8cb689424d01f6eaf7217adfcff65b51a30774a77fff8006c21c7059350' },
  { symbol: 'NTES', name: 'NetEase ADR', cn: '网易', board: 'ADR', currency: 'USD', yahoo: 'NTES', pythFeedId: '664fc65e3f9ffb458e7144959ed8d5c86e923eb7ca283efeadb79bd6c1e4b9ce' },
  { symbol: 'TCOM', name: 'Trip.com', cn: '携程', board: 'ADR', currency: 'USD', yahoo: 'TCOM', pythFeedId: '37527d726792538d5b968b8d5777044cda4413f7814e24978d9a3a9094157c2b' },
  { symbol: 'NIO', name: 'NIO', cn: '蔚来', board: 'ADR', currency: 'USD', yahoo: 'NIO', pythFeedId: 'c8916a12ca17ed0883e37a10c8962370fbd2878a35bb70f6902a0f52be73338c' },
  { symbol: 'LI', name: 'Li Auto ADR', cn: '理想汽车', board: 'ADR', currency: 'USD', yahoo: 'LI', pythFeedId: 'b10d624c07226d795e9211c9ac95baf43b4a4234ac89cd319e3c72b20de92f99' },
  { symbol: 'XPEV', name: 'XPeng', cn: '小鹏汽车', board: 'ADR', currency: 'USD', yahoo: 'XPEV', pythFeedId: '9898aa7f08a1ed39d930640595a03f4aaf638c1875763fb94eab70cc0c6d3ed5' },
  { symbol: 'BILI', name: 'Bilibili', cn: '哔哩哔哩', board: 'ADR', currency: 'USD', yahoo: 'BILI', pythFeedId: '006d336e4cd222530a057ed307c619af1379a4dedfc4839dcbab413df956fbaa' },
  { symbol: 'TME', name: 'Tencent Music', cn: '腾讯音乐', board: 'ADR', currency: 'USD', yahoo: 'TME', pythFeedId: '4e9ad694400495593cf8180ffa42490c64a0c721f1c3b2b7ad42c92c7294fd6b' },
  { symbol: 'BEKE', name: 'KE Holdings', cn: '贝壳', board: 'ADR', currency: 'USD', yahoo: 'BEKE', pythFeedId: '7da2dc2834b1c9b412a11f414f2ad14814a976e2c7d613ce3c7635b7bde1e036' },
  { symbol: 'YUMC', name: 'Yum China', cn: '百胜中国', board: 'ADR', currency: 'USD', yahoo: 'YUMC', pythFeedId: '858c14a1577497bd38969a2b30222fde8241b38566435dc69f68f4c6da45cb0e' },
  { symbol: 'FUTU', name: 'Futu', cn: '富途控股', board: 'ADR', currency: 'USD', yahoo: 'FUTU', rhToken: 'FUTU', pythFeedId: 'e6d51d83a2d18919bf5c57604bf3bf581d65efe34d232ba1d0ef33eca03c983f' },
  { symbol: 'EDU', name: 'New Oriental', cn: '新东方', board: 'ADR', currency: 'USD', yahoo: 'EDU', pythFeedId: '6c409f638d764e93701e076bb41a20a46324f8533401b1b3cc4cd754c04d5dc4' },
  { symbol: 'FXI', name: 'iShares China Large-Cap', cn: '中国大盘股', board: 'ADR', currency: 'USD', yahoo: 'FXI', pythFeedId: '978c107498c949190c0b9bb1ad408eb643b7317ad43539ff43897cab967d7fd3' },
  { symbol: 'KWEB', name: 'KraneShares China Internet', cn: '中国互联网', board: 'ADR', currency: 'USD', yahoo: 'KWEB', pythFeedId: '8a11c9ba1c8a59571188ff14ca1cc096520eae277de4ff8bc5a6b58939efb096' },
  { symbol: 'MCHI', name: 'iShares MSCI China', cn: '明晟中国', board: 'ADR', currency: 'USD', yahoo: 'MCHI', pythFeedId: '33e3853fe3382522aec843bcc3e795bc62ef9d48a47fe2ea7e777926a7ac70f7' },
];

// FX.USD/HKD — HK prices are converted to USD because every market settles in USDC.
export const USD_HKD_FEED_ID = '19d75fde7fee50fe67753fdc825e583594eb2f51ae84e114a5246c4ab23aff4c';

export const findAsset = (symbol: string) =>
  ASSETS.find((a) => a.symbol.toUpperCase() === symbol.toUpperCase());
