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
    { no: 1, t: '병리학의 개요와 세포 손상 및 적응', ready: true }
  ] }
];
