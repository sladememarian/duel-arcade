// game/triviaQuestions.js
// Question bank for Trivia Royale. Each: { category, text, options[4], answer (index) }.
// Kept deliberately broad and fun. `answer` is the 0-based index into options.

const QUESTIONS = [
  { category: 'Geography', text: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], answer: 2 },
  { category: 'Geography', text: 'Which is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answer: 3 },
  { category: 'Geography', text: 'Mount Everest sits on the border of Nepal and which country?', options: ['India', 'China', 'Bhutan', 'Pakistan'], answer: 1 },
  { category: 'Geography', text: 'Which country has the most natural lakes?', options: ['USA', 'Russia', 'Canada', 'Finland'], answer: 2 },
  { category: 'Geography', text: 'The Sahara Desert is located on which continent?', options: ['Asia', 'Africa', 'Australia', 'South America'], answer: 1 },
  { category: 'Geography', text: 'What is the longest river in the world?', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], answer: 1 },
  { category: 'Geography', text: 'Which city is known as the "Big Apple"?', options: ['Los Angeles', 'Chicago', 'New York City', 'Boston'], answer: 2 },

  { category: 'Science', text: 'What is the chemical symbol for gold?', options: ['Gd', 'Au', 'Ag', 'Go'], answer: 1 },
  { category: 'Science', text: 'How many planets are in our solar system?', options: ['7', '8', '9', '10'], answer: 1 },
  { category: 'Science', text: 'What gas do plants absorb from the atmosphere?', options: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen'], answer: 2 },
  { category: 'Science', text: 'What is the powerhouse of the cell?', options: ['Nucleus', 'Ribosome', 'Mitochondria', 'Golgi body'], answer: 2 },
  { category: 'Science', text: 'At what temperature does water boil at sea level (°C)?', options: ['90', '100', '110', '120'], answer: 1 },
  { category: 'Science', text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Jupiter', 'Mars', 'Saturn'], answer: 2 },
  { category: 'Science', text: 'What is the hardest known natural material?', options: ['Quartz', 'Diamond', 'Titanium', 'Granite'], answer: 1 },
  { category: 'Science', text: 'How many bones are in the adult human body?', options: ['186', '206', '226', '246'], answer: 1 },

  { category: 'History', text: 'In which year did World War II end?', options: ['1943', '1945', '1947', '1950'], answer: 1 },
  { category: 'History', text: 'Who was the first President of the United States?', options: ['Thomas Jefferson', 'Abraham Lincoln', 'George Washington', 'John Adams'], answer: 2 },
  { category: 'History', text: 'The Great Wall is located in which country?', options: ['Japan', 'China', 'Mongolia', 'Korea'], answer: 1 },
  { category: 'History', text: 'Which ancient civilization built the pyramids of Giza?', options: ['Romans', 'Greeks', 'Egyptians', 'Mayans'], answer: 2 },
  { category: 'History', text: 'Who painted the Mona Lisa?', options: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Donatello'], answer: 1 },

  { category: 'Pop Culture', text: 'Which planet does Superman come from?', options: ['Mars', 'Krypton', 'Tatooine', 'Asgard'], answer: 1 },
  { category: 'Pop Culture', text: 'What is the name of the wizarding school in Harry Potter?', options: ['Durmstrang', 'Beauxbatons', 'Hogwarts', 'Ilvermorny'], answer: 2 },
  { category: 'Pop Culture', text: 'Which company created the Mario franchise?', options: ['Sega', 'Sony', 'Nintendo', 'Atari'], answer: 2 },
  { category: 'Pop Culture', text: 'In "Frozen", what is the name of Elsa\'s sister?', options: ['Anna', 'Elsa', 'Belle', 'Aurora'], answer: 0 },
  { category: 'Pop Culture', text: 'What does the "S" stand for on a chessboard piece "N"? (the knight)', options: ['Soldier', 'Knight', 'Steed', 'Squire'], answer: 1 },

  { category: 'Sports', text: 'How many players are on a standard soccer team on the field?', options: ['9', '10', '11', '12'], answer: 2 },
  { category: 'Sports', text: 'In which sport would you perform a "slam dunk"?', options: ['Volleyball', 'Basketball', 'Tennis', 'Hockey'], answer: 1 },
  { category: 'Sports', text: 'How often are the Summer Olympic Games held?', options: ['Every 2 years', 'Every 3 years', 'Every 4 years', 'Every 5 years'], answer: 2 },
  { category: 'Sports', text: 'What is the maximum score in a single frame of ten-pin bowling?', options: ['10', '20', '30', '300'], answer: 2 },

  { category: 'Math', text: 'What is 12 × 12?', options: ['124', '144', '154', '164'], answer: 1 },
  { category: 'Math', text: 'What is the value of Pi rounded to two decimals?', options: ['3.14', '3.16', '3.12', '3.18'], answer: 0 },
  { category: 'Math', text: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], answer: 1 },
  { category: 'Math', text: 'What is 15% of 200?', options: ['25', '30', '35', '40'], answer: 1 },

  { category: 'Nature', text: 'What is the largest land animal?', options: ['Rhino', 'Hippo', 'African Elephant', 'Giraffe'], answer: 2 },
  { category: 'Nature', text: 'Which bird is known for its ability to mimic human speech?', options: ['Eagle', 'Parrot', 'Owl', 'Penguin'], answer: 1 },
  { category: 'Nature', text: 'How many legs does a spider have?', options: ['6', '8', '10', '12'], answer: 1 },
  { category: 'Nature', text: 'What is a group of lions called?', options: ['Pack', 'Herd', 'Pride', 'Flock'], answer: 2 },
  { category: 'Nature', text: 'Which is the fastest land animal?', options: ['Lion', 'Cheetah', 'Horse', 'Gazelle'], answer: 1 },

  { category: 'Food', text: 'Which country is famous for inventing pizza?', options: ['France', 'Italy', 'Greece', 'Spain'], answer: 1 },
  { category: 'Food', text: 'What is the main ingredient in guacamole?', options: ['Tomato', 'Avocado', 'Pepper', 'Onion'], answer: 1 },
  { category: 'Food', text: 'Sushi originates from which country?', options: ['China', 'Thailand', 'Japan', 'Korea'], answer: 2 },

  { category: 'Tech', text: 'What does "CPU" stand for?', options: ['Central Process Unit', 'Central Processing Unit', 'Computer Personal Unit', 'Core Processing Utility'], answer: 1 },
  { category: 'Tech', text: 'Who is the co-founder of Microsoft?', options: ['Steve Jobs', 'Bill Gates', 'Elon Musk', 'Mark Zuckerberg'], answer: 1 },
  { category: 'Tech', text: 'What does "HTTP" stand for?', options: ['HyperText Transfer Protocol', 'High Transfer Text Process', 'HyperText Transmission Protocol', 'Home Tool Transfer Protocol'], answer: 0 },
  { category: 'Tech', text: 'Which language runs natively in web browsers?', options: ['Python', 'Java', 'JavaScript', 'C++'], answer: 2 },
];

module.exports = { QUESTIONS };
