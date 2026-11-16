window.CFG = {
  url: 'https://zgvnwsbqwoozzkdmlntp.supabase.co',
  key: 'sb_publishable_rF73z1TejUFwIkCjCKcv1Q_fXei1wLB',
  profEmail: 'ptyang@scjc.ac.kr',
  course: '물리치료사를 위한 병리학'
};
/* 장 데이터 등록소 — js/data/chNN.js 가 PA.add({...}) 로 등록 */
window.PA = { ch: {}, add(c) { this.ch[c.no] = c; } };
/* 교재 구성: 장을 추가하면 ready 를 true 로 */
window.PARTS = [
  { no: 1, t: 'Part 1 병리학 총론 (기초 병리학)', chapters: [
    { no: 1, t: '병리학의 개요와 세포 손상 및 적응', ready: true },
    { no: 2, t: '염증과 조직 치유', ready: true },
    { no: 3, t: '순환장애', ready: true },
    { no: 4, t: '면역질환과 감염병', ready: true },
    { no: 5, t: '종양병리학', ready: true },
    { no: 6, t: '유전질환 및 환경·영양병리학', ready: true }
  ] },
  { no: 2, t: 'Part 2 병리학 각론 (계통별 임상 병리학)', chapters: [
    { no: 7, t: '근골격계 병리학 (뼈와 관절)', ready: true },
    { no: 8, t: '근골격계 병리학 (근육과 연부조직)', ready: true },
    { no: 9, t: '신경계 병리학', ready: true },
    { no: 10, t: '심혈관계 병리학', ready: true },
    { no: 11, t: '호흡기계 병리학', ready: true },
    { no: 12, t: '소화기계 및 간담도계 병리학', ready: true },
    { no: 13, t: '내분비계 및 대사성 질환 병리학', ready: true },
    { no: 14, t: '비뇨생식기계 및 조혈계 병리학', ready: true }
  ] }
];
